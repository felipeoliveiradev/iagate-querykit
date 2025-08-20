import { QueryKitConfig } from './config';
import { eventManager } from './event-manager';

type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';
type TriggerTiming = 'BEFORE' | 'AFTER' | 'INSTEAD OF';

// Semantic triggers (application-level)
export type SemanticTriggerAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'READ';
export type SemanticTriggerTiming = 'BEFORE' | 'AFTER';
const ALL_ACTIONS: SemanticTriggerAction[] = ['INSERT','UPDATE','DELETE','READ'];
export type NormalizedFilter = { type: string; column?: string; operator?: string; value?: any; logical?: 'AND' | 'OR'; not?: boolean };
export type TriggerContext = {
  table: string;
  action: SemanticTriggerAction;
  timing: SemanticTriggerTiming;
  data?: any;
  where?: { sql: string; bindings: any[]; filters?: NormalizedFilter[] };
  rows?: any[];
  result?: { changes?: number; lastInsertRowid?: number | bigint };
};
export type SemanticTriggerBody = string | ((ctx: TriggerContext) => any | Promise<any>);
export type ParallelBody = { parallel: (SemanticTriggerBody)[] };
export type SemanticTriggerBodyUnion = SemanticTriggerBody | SemanticTriggerBody[] | ParallelBody;
export type CreateSemanticTriggerOptions = {
  when: SemanticTriggerTiming;
  action: SemanticTriggerAction | '*' | Array<SemanticTriggerAction | '*'>;
  except?: Array<SemanticTriggerAction | '*'>;
  table: string | string[];
  body: SemanticTriggerBodyUnion;
  state?: 'bank' | 'state';
};

export class TriggerManager {
  private static semantic: Map<string, { opts: CreateSemanticTriggerOptions; offs: (() => void)[]; sqlNames: string[] } > = new Map();

  private static eventNameFor(when: SemanticTriggerTiming, action: SemanticTriggerAction, table: string): string {
    return `querykit:trigger:${when}:${action}:${table}`;
  }

  private static async runBody(body: SemanticTriggerBodyUnion, ctx: TriggerContext) {
    if (Array.isArray(body)) {
      for (const b of body) { await TriggerManager.runBody(b, ctx); }
      return;
    }
    if (typeof body === 'object' && body && 'parallel' in body && Array.isArray((body as ParallelBody).parallel)) {
      const p = (body as ParallelBody).parallel;
      await Promise.all(p.map((b) => TriggerManager.runBody(b, ctx)));
      return;
    }
    if (typeof body === 'string') {
      const exec = QueryKitConfig.defaultExecutor;
      if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit');
      exec.runSync(body, []);
      return;
    }
    if (typeof body === 'function') {
      const out = await Promise.resolve((body as (ctx: TriggerContext) => any)(ctx));
      if (out !== undefined && out !== null) {
        await TriggerManager.runBody(out as any, ctx);
      }
      return;
    }
  }

  private static attachListenerFor(when: SemanticTriggerTiming, action: SemanticTriggerAction, table: string, body: SemanticTriggerBodyUnion): () => void {
    const handler = async (ctx: TriggerContext) => {
      await TriggerManager.runBody(body, ctx);
    };
    return eventManager.on(TriggerManager.eventNameFor(when, action, table), handler);
  }

  private static serializeBodyToSql(body: SemanticTriggerBodyUnion): string | null {
    const flatten = (b: SemanticTriggerBodyUnion): (string | null)[] => {
      if (Array.isArray(b)) return b.flatMap(x => flatten(x));
      if (typeof b === 'object' && b && 'parallel' in b && Array.isArray((b as ParallelBody).parallel)) {
        return (b as ParallelBody).parallel.flatMap(x => flatten(x));
      }
      if (typeof b === 'string') return [b];
      // functions cannot be represented in SQL trigger bodies
      return [null];
    };
    const parts = flatten(body);
    if (parts.every(p => p === null)) return null;
    const sqls = parts.filter((p): p is string => typeof p === 'string');
    if (sqls.length === 0) return null;
    const joined = sqls.map(s => s.trim().replace(/;\s*$/,'')).join('; ');
    return joined.length ? joined + ';' : '';
  }

  private static extractSqlStrings(body: SemanticTriggerBodyUnion): string[] {
    const out: string[] = [];
    const walk = (b: SemanticTriggerBodyUnion) => {
      if (Array.isArray(b)) { b.forEach(walk); return; }
      if (typeof b === 'object' && b && 'parallel' in (b as any) && Array.isArray((b as ParallelBody).parallel)) {
        (b as ParallelBody).parallel.forEach(walk); return;
      }
      if (typeof b === 'string') out.push(b);
    };
    walk(body);
    return out;
  }

  private static extractNonSql(body: SemanticTriggerBodyUnion): SemanticTriggerBodyUnion | null {
    const toNonSql = (b: SemanticTriggerBodyUnion): SemanticTriggerBodyUnion | null => {
      if (Array.isArray(b)) {
        const sequential: SemanticTriggerBody[] = [];
        for (const item of b) {
          const cleaned = toNonSql(item);
          if (!cleaned) continue;
          if (typeof cleaned === 'function') {
            sequential.push(cleaned);
          } else if (typeof cleaned === 'object' && 'parallel' in (cleaned as any)) {
            // flatten parallel functions into the sequence to preserve type correctness
            const par = (cleaned as ParallelBody).parallel.filter((x) => typeof x === 'function') as SemanticTriggerBody[];
            sequential.push(...par);
          }
          // strings are excluded (SQL handled by DB trigger)
        }
        return sequential.length ? sequential : null;
      }
      if (typeof b === 'object' && b && 'parallel' in (b as any) && Array.isArray((b as ParallelBody).parallel)) {
        const onlyFns = (b as ParallelBody).parallel.filter((x) => typeof x === 'function') as SemanticTriggerBody[];
        return onlyFns.length ? ({ parallel: onlyFns } as ParallelBody) : null;
      }
      if (typeof b === 'string') return null;
      if (typeof b === 'function') return b;
      return null;
    };
    return toNonSql(body);
  }

  public create(name: string, opts: CreateSemanticTriggerOptions): void {
    this.drop(name);
    const offs: (() => void)[] = [];
    const createdSql: string[] = [];
    const when = opts.when;
    const actionsArr = Array.isArray(opts.action) ? opts.action : [opts.action];
    const exceptArr = Array.isArray(opts.except) ? opts.except : [];
    const tablesArr = Array.isArray(opts.table) ? opts.table : [opts.table];
    const expandedActions: SemanticTriggerAction[] = actionsArr.flatMap(a => a === '*' ? ALL_ACTIONS : [a as SemanticTriggerAction]);
    const excluded: Set<SemanticTriggerAction> = new Set(exceptArr.flatMap(a => a === '*' ? ALL_ACTIONS : [a as SemanticTriggerAction]));
    const finalActions = expandedActions.filter(a => !excluded.has(a));
    const targetState = opts.state || 'bank';

    const sqlParts = TriggerManager.extractSqlStrings(opts.body);
    const sqlBody = sqlParts.length ? sqlParts.map(s => s.trim().replace(/;\s*$/,'')).join('; ') + ';' : null;
    const nonSql = TriggerManager.extractNonSql(opts.body);

    for (const action of finalActions) {
      for (const table of tablesArr) {
        const canUseSql = targetState === 'bank' && sqlBody && action !== 'READ';
        if (canUseSql) {
          const sqlTriggerName = `${name}__${when}__${action}__${table}`;
          this.createTrigger(sqlTriggerName, table, when as TriggerTiming, action as TriggerEvent, sqlBody!);
          createdSql.push(sqlTriggerName);
        }
        const bodyForSemantic = targetState === 'state' ? opts.body : nonSql;
        if (bodyForSemantic) {
          const off = TriggerManager.attachListenerFor(when, action, table, bodyForSemantic);
          offs.push(off);
        }
        if (!canUseSql && !bodyForSemantic) {
          // nothing to attach; fallback to original body in memory
          const off = TriggerManager.attachListenerFor(when, action, table, opts.body);
          offs.push(off);
        }
      }
    }

    TriggerManager.semantic.set(name, { opts, offs, sqlNames: createdSql });
  }

  public drop(name: string): void {
    const entry = TriggerManager.semantic.get(name);
    if (entry) {
      for (const off of entry.offs) { try { off(); } catch {} }
      for (const sqlName of entry.sqlNames || []) { try { this.dropTrigger(sqlName); } catch {} }
      TriggerManager.semantic.delete(name);
    }
  }

  public async dropAsync(name: string): Promise<void> {
    const entry = TriggerManager.semantic.get(name);
    if (entry) {
      for (const off of entry.offs) { try { off(); } catch {} }
      for (const sqlName of entry.sqlNames || []) { try { await Promise.resolve(this.dropTrigger(sqlName)); } catch {} }
      TriggerManager.semantic.delete(name);
    }
  }

  public dropAll(): void {
    for (const [name] of TriggerManager.semantic) {
      try { this.drop(name); } catch {}
    }
  }

  public list(): string[] {
    return Array.from(TriggerManager.semantic.keys());
  }

  public listDetailed(): { bank_triggers: string[]; state_triggers: string[] } {
    const bank_triggers: string[] = (() => { try { return this.listTriggers(); } catch { return []; } })();
    const state_triggers: string[] = Array.from(TriggerManager.semantic.entries())
      .filter(([_, v]) => (v.offs && v.offs.length > 0))
      .map(([k]) => k);
    return { bank_triggers, state_triggers };
  }

  public async listDetailedAsync(): Promise<{ bank_triggers: string[]; state_triggers: string[] }> {
    const bank_triggers: string[] = await (async () => { try { return await this.listTriggersAsync(); } catch { return []; } })();
    const state_triggers: string[] = Array.from(TriggerManager.semantic.entries())
      .filter(([_, v]) => (v.offs && v.offs.length > 0))
      .map(([k]) => k);
    return { bank_triggers, state_triggers };
  }

  // SQL-level triggers (multi-vendor)
  public createTrigger(name: string, tableName: string, timing: TriggerTiming, event: TriggerEvent, body: string): void {
    const createTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${name}
      ${timing} ${event} ON ${tableName}
      FOR EACH ROW
      BEGIN
        ${body}
      END;
    `;
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (exec.runSync) exec.runSync(createTriggerSql, []);
    else exec.executeQuery(createTriggerSql, []);
  }

  public dropTrigger(name: string): void {
    const dropTriggerSql = `DROP TRIGGER IF EXISTS ${name}`;
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (exec.runSync) exec.runSync(dropTriggerSql, []);
    else exec.executeQuery(dropTriggerSql, []);
  }

  private triggerQueriesByDialect(dialect?: string) {
    switch (dialect) {
      case 'sqlite': return [{ sql: "SELECT name FROM sqlite_master WHERE type='trigger'", map: (r: any) => r.name }];
      case 'mysql': return [{ sql: "SELECT TRIGGER_NAME AS name FROM INFORMATION_SCHEMA.TRIGGERS", map: (r: any) => r.name }];
      case 'postgres': return [{ sql: "SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal", map: (r: any) => r.tgname || r.name }];
      case 'mssql': return [{ sql: "SELECT name FROM sys.triggers", map: (r: any) => r.name }];
      case 'oracle': return [{ sql: "SELECT TRIGGER_NAME AS name FROM USER_TRIGGERS", map: (r: any) => r.name }];
      default:
        return [
          { sql: "SELECT name FROM sqlite_master WHERE type='trigger'", map: (r: any) => r.name },
          { sql: "SELECT TRIGGER_NAME AS name FROM INFORMATION_SCHEMA.TRIGGERS", map: (r: any) => r.name },
          { sql: "SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal", map: (r: any) => r.tgname || r.name },
          { sql: "SELECT name FROM sys.triggers", map: (r: any) => r.name },
          { sql: "SELECT TRIGGER_NAME AS name FROM USER_TRIGGERS", map: (r: any) => r.name },
        ];
    }
  }

  public listTriggers(): string[] {
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (!exec.executeQuerySync) return [];
    const candidates = this.triggerQueriesByDialect(exec.dialect || (QueryKitConfig as any).defaultDialect);
    for (const c of candidates) {
      try {
        const res = exec.executeQuerySync(c.sql, []);
        const rows = (res?.data as any[]) || [];
        const names = rows.map(c.map).filter(Boolean);
        if (names.length || rows.length >= 0) return names;
      } catch { /* try next */ }
    }
    return [];
  }

  public triggerExists(name: string): boolean {
    const names = this.listTriggers();
    return names.includes(name);
  }

  public async listTriggersAsync(): Promise<string[]> {
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (exec.executeQuerySync) return this.listTriggers();
    const candidates = this.triggerQueriesByDialect(exec.dialect || (QueryKitConfig as any).defaultDialect);
    for (const c of candidates) {
      try {
        const res = await exec.executeQuery(c.sql, []);
        const rows = (res?.data as any[]) || [];
        const names = rows.map(c.map).filter(Boolean);
        if (names.length || rows.length >= 0) return names;
      } catch { /* try next */ }
    }
    return [];
  }

  public async triggerExistsAsync(name: string): Promise<boolean> {
    const names = await this.listTriggersAsync();
    return names.includes(name);
  }
} 