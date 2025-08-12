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
};

export class TriggerManager {
  private static semantic: Map<string, { opts: CreateSemanticTriggerOptions; offs: (() => void)[] } > = new Map();

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
      if (Array.isArray(out)) {
        await Promise.all(out.map((v: any) => Promise.resolve(v)));
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

  public create(name: string, opts: CreateSemanticTriggerOptions): void {
    this.drop(name);
    const offs: (() => void)[] = [];
    const when = opts.when;
    const actionsArr = Array.isArray(opts.action) ? opts.action : [opts.action];
    const exceptArr = Array.isArray(opts.except) ? opts.except : [];
    const tablesArr = Array.isArray(opts.table) ? opts.table : [opts.table];
    const expandedActions: SemanticTriggerAction[] = actionsArr.flatMap(a => a === '*' ? ALL_ACTIONS : [a as SemanticTriggerAction]);
    const excluded: Set<SemanticTriggerAction> = new Set(exceptArr.flatMap(a => a === '*' ? ALL_ACTIONS : [a as SemanticTriggerAction]));
    const finalActions = expandedActions.filter(a => !excluded.has(a));
    for (const action of finalActions) {
      for (const table of tablesArr) {
        const off = TriggerManager.attachListenerFor(when, action, table, opts.body);
        offs.push(off);
      }
    }
    TriggerManager.semantic.set(name, { opts, offs });
  }

  public drop(name: string): void {
    const entry = TriggerManager.semantic.get(name);
    if (entry) {
      for (const off of entry.offs) { try { off(); } catch {} }
      TriggerManager.semantic.delete(name);
    }
  }

  public list(): string[] {
    return Array.from(TriggerManager.semantic.keys());
  }

  // SQL-level triggers (SQLite)
  public createTrigger(name: string, tableName: string, timing: TriggerTiming, event: TriggerEvent, body: string): void {
    const createTriggerSql = `
      CREATE TRIGGER IF NOT EXISTS ${name}
      ${timing} ${event} ON ${tableName}
      FOR EACH ROW
      BEGIN
        ${body}
      END;
    `;
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit');
    exec.runSync(createTriggerSql, []);
  }

  public dropTrigger(name: string): void {
    const dropTriggerSql = `DROP TRIGGER IF EXISTS ${name}`;
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit');
    exec.runSync(dropTriggerSql, []);
  }

  public listTriggers(): string[] {
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const rows = exec.executeQuerySync("SELECT name FROM sqlite_master WHERE type='trigger'", []).data as any[];
    return rows.map(row => row.name);
  }

  public triggerExists(name: string): boolean {
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const row = exec.executeQuerySync("SELECT name FROM sqlite_master WHERE type='trigger' AND name= ?", [name]).data[0];
    return !!row;
  }
} 