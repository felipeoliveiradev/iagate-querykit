import { QueryKitConfig } from './config';
import { eventManager } from './event-manager';

/**
 * Tipos de eventos que podem disparar triggers SQL.
 */
type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Momentos em que um trigger SQL pode ser executado.
 */
type TriggerTiming = 'BEFORE' | 'AFTER' | 'INSTEAD OF';

/**
 * Ações semânticas que podem disparar triggers de aplicação.
 * Inclui operações de leitura além das operações CRUD tradicionais.
 */
export type SemanticTriggerAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'READ';

/**
 * Momentos semânticos para execução de triggers de aplicação.
 */
export type SemanticTriggerTiming = 'BEFORE' | 'AFTER';

/**
 * Array com todas as ações semânticas possíveis.
 */
const ALL_ACTIONS: SemanticTriggerAction[] = ['INSERT','UPDATE','DELETE','READ'];

/**
 * Filtro normalizado para condições de trigger.
 * Permite definir condições complexas com operadores lógicos.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const filter: NormalizedFilter = {
 *   type: 'column',
 *   column: 'age',
 *   operator: '>',
 *   value: 18,
 *   logical: 'AND',
 *   not: false
 * };
 * 
 * // Como usar
 * // Filtro aplicado em condições de trigger
 * 
 * // Output: Filtro configurado para idade > 18
 * ```
 */
export type NormalizedFilter = { 
  type: string; 
  column?: string; 
  operator?: string; 
  value?: any; 
  logical?: 'AND' | 'OR'; 
  not?: boolean 
};

/**
 * Contexto passado para execução de triggers semânticos.
 * Contém informações sobre a operação, dados e resultados.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const context: TriggerContext = {
 *   table: 'users',
 *   action: 'INSERT',
 *   timing: 'AFTER',
 *   data: { name: 'John', email: 'john@example.com' },
 *   result: { changes: 1, lastInsertRowid: 123 }
 * };
 * 
 * // Como usar
 * // Contexto passado para função de trigger
 * 
 * // Output: Contexto completo da operação de inserção
 * ```
 */
export type TriggerContext = {
  /** Nome da tabela afetada */
  table: string;
  /** Ação que disparou o trigger */
  action: SemanticTriggerAction;
  /** Momento de execução do trigger */
  timing: SemanticTriggerTiming;
  /** Dados da operação (para INSERT/UPDATE) */
  data?: any;
  /** Condições WHERE da operação */
  where?: { sql: string; bindings: any[]; filters?: NormalizedFilter[] };
  /** Linhas afetadas pela operação */
  rows?: any[];
  /** Resultado da operação (mudanças, IDs) */
  result?: { changes?: number; lastInsertRowid?: number | bigint };
};

/**
 * Corpo de um trigger semântico.
 * Pode ser uma string SQL, função ou ambos.
 */
export type SemanticTriggerBody = string | ((ctx: TriggerContext) => any | Promise<any>);

/**
 * Corpo de trigger com execução paralela.
 * Permite executar múltiplas ações simultaneamente.
 */
export type ParallelBody = { parallel: (SemanticTriggerBody)[] };

/**
 * União de todos os tipos possíveis de corpo de trigger.
 * Suporta execução sequencial, paralela e mista.
 */
export type SemanticTriggerBodyUnion = SemanticTriggerBody | SemanticTriggerBody[] | ParallelBody;

/**
 * Opções para criação de triggers semânticos.
 * Define quando, onde e como o trigger será executado.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const options: CreateSemanticTriggerOptions = {
 *   when: 'AFTER',
 *   action: 'INSERT',
 *   table: 'users',
 *   body: 'INSERT INTO audit_log (table_name, action) VALUES (?, ?)',
 *   state: 'bank'
 * };
 * 
 * // Como usar
 * triggerManager.create('user_audit', options);
 * 
 * // Output: Trigger 'user_audit' criado para auditar inserções na tabela users
 * ```
 */
export type CreateSemanticTriggerOptions = {
  /** Momento de execução do trigger */
  when: SemanticTriggerTiming;
  /** Ações que disparam o trigger (aceita '*' para todas) */
  action: SemanticTriggerAction | '*' | Array<SemanticTriggerAction | '*'>;
  /** Ações que NÃO disparam o trigger */
  except?: Array<SemanticTriggerAction | '*'>;
  /** Tabelas onde o trigger será aplicado */
  table: string | string[];
  /** Corpo do trigger (SQL, função ou ambos) */
  body: SemanticTriggerBodyUnion;
  /** Estado onde o trigger será executado ('bank' ou 'state') */
  state?: 'bank' | 'state';
};

/**
 * Gerenciador de triggers para o QueryKit.
 * Suporta triggers SQL nativos e triggers semânticos de aplicação.
 * Permite execução síncrona e assíncrona com suporte a múltiplos dialetos.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const triggerManager = new TriggerManager();
 * 
 * // Como usar
 * triggerManager.create('user_audit', {
 *   when: 'AFTER',
 *   action: 'INSERT',
 *   table: 'users',
 *   body: (ctx) => console.log('Usuário inserido:', ctx.data)
 * });
 * 
 * // Output: Trigger semântico criado para auditar inserções de usuários
 * ```
 */
export class TriggerManager {
  private static semantic: Map<string, { opts: CreateSemanticTriggerOptions; offs: (() => void)[]; sqlNames: string[] } > = new Map();

  /**
   * Gera nome único para evento baseado no timing, ação e tabela.
   * 
   * @param when - Momento de execução
   * @param action - Ação que dispara o trigger
   * @param table - Tabela afetada
   * @returns Nome único do evento
   */
  private static eventNameFor(when: SemanticTriggerTiming, action: SemanticTriggerAction, table: string): string {
    return `querykit:trigger:${when}:${action}:${table}`;
  }

  /**
   * Executa o corpo de um trigger semântico.
   * Suporta strings SQL, funções, arrays e execução paralela.
   * 
   * @param body - Corpo do trigger a ser executado
   * @param ctx - Contexto da operação
   * @returns Promise que resolve quando a execução terminar
   */
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

  /**
   * Anexa listener para um evento específico de trigger.
   * 
   * @param when - Momento de execução
   * @param action - Ação que dispara o trigger
   * @param table - Tabela afetada
   * @param body - Corpo do trigger
   * @returns Função para cancelar o listener
   */
  private static attachListenerFor(when: SemanticTriggerTiming, action: SemanticTriggerAction, table: string, body: SemanticTriggerBodyUnion): () => void {
    const handler = async (ctx: TriggerContext) => {
      await TriggerManager.runBody(body, ctx);
    };
    return eventManager.on(TriggerManager.eventNameFor(when, action, table), handler);
  }

  /**
   * Serializa corpo do trigger para SQL quando possível.
   * Funções não podem ser representadas em SQL, retornando null.
   * 
   * @param body - Corpo do trigger para serializar
   * @returns SQL serializado ou null se não for possível
   */
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

  /**
   * Extrai todas as strings SQL de um corpo de trigger.
   * Útil para separar SQL de funções JavaScript.
   * 
   * @param body - Corpo do trigger para extrair SQL
   * @returns Array com todas as strings SQL encontradas
   */
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

  /**
   * Extrai partes não-SQL de um corpo de trigger.
   * Retorna apenas funções JavaScript, excluindo strings SQL.
   * 
   * @param body - Corpo do trigger para extrair partes não-SQL
   * @returns Corpo do trigger sem strings SQL ou null se não houver funções
   */
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

  /**
   * Cria um trigger semântico com as opções especificadas.
   * Remove trigger existente com o mesmo nome antes de criar.
   * Suporta execução em banco de dados (SQL) e/ou aplicação (JavaScript).
   * 
   * @param name - Nome único do trigger
   * @param opts - Opções de configuração do trigger
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const triggerManager = new TriggerManager();
   * 
   * // Como usar
   * triggerManager.create('user_validation', {
   *   when: 'BEFORE',
   *   action: 'INSERT',
   *   table: 'users',
   *   body: (ctx) => {
   *     if (!ctx.data.email.includes('@')) {
   *       throw new Error('Email inválido');
   *     }
   *   }
   * });
   * 
   * // Output: Trigger 'user_validation' criado para validar emails antes da inserção
   * ```
   */
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

  /**
   * Remove um trigger semântico pelo nome.
   * Cancela listeners e remove triggers SQL associados.
   * 
   * @param name - Nome do trigger a ser removido
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * triggerManager.create('temp_trigger', {  ...  });
   * 
   * // Como usar
   * triggerManager.drop('temp_trigger');
   * 
   * // Output: Trigger 'temp_trigger' removido e recursos liberados
   * ```
   */
  public drop(name: string): void {
    const entry = TriggerManager.semantic.get(name);
    if (entry) {
      for (const off of entry.offs) { try { off(); } catch {} }
      for (const sqlName of entry.sqlNames || []) { try { this.dropTrigger(sqlName); } catch {} }
      TriggerManager.semantic.delete(name);
    }
  }

  /**
   * Remove um trigger semântico de forma assíncrona.
   * Versão assíncrona do método drop().
   * 
   * @param name - Nome do trigger a ser removido
   * @returns Promise que resolve quando o trigger for removido
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * await triggerManager.create('async_trigger', {  ... });
   * 
   * // Como usar
   * await triggerManager.dropAsync('async_trigger');
   * 
   * // Output: Promise resolve quando trigger 'async_trigger' for removido
   * ```
   */
  public async dropAsync(name: string): Promise<void> {
    const entry = TriggerManager.semantic.get(name);
    if (entry) {
      for (const off of entry.offs) { try { off(); } catch {} }
      for (const sqlName of entry.sqlNames || []) { try { await Promise.resolve(this.dropTrigger(sqlName)); } catch {} }
      TriggerManager.semantic.delete(name);
    }
  }

  /**
   * Remove todos os triggers semânticos ativos.
   * Limpa todos os listeners e triggers SQL criados.
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * triggerManager.create('trigger1', {  ...  });
   * triggerManager.create('trigger2', {  ... *});
   * 
   * // Como usar
   * triggerManager.dropAll();
   * 
   * // Output: Todos os triggers removidos e recursos liberados
   * ```
   */
  public dropAll(): void {
    for (const [name] of TriggerManager.semantic) {
      try { this.drop(name); } catch {}
    }
  }

  /**
   * Lista nomes de todos os triggers semânticos ativos.
   * 
   * @returns Array com nomes dos triggers ativos
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * triggerManager.create('user_audit', { ...  });
   * triggerManager.create('product_log', { ...  });
   * 
   * // Como usar
   * const triggers = triggerManager.list();
   * 
   * // Output: ['user_audit', 'product_log']
   * ```
   */
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