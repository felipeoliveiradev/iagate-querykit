import { QueryKitConfig } from './config.js';
import type { QueryBuilder } from './query-builder.js';
import { scheduler } from './scheduler.js';
import { table } from './table.js';
import { quoteIdent } from './sql/identifiers.js';
import { inlineBindings } from './sql/literals.js';
import type { DatabaseExecutor } from './types.js';
import type { SqlDialect } from './sql/dialect.js';

/**
 * Retorna queries específicas para listar views baseado no dialeto SQL.
 * Cada dialeto tem sua própria sintaxe para consultar views do sistema.
 * 
 * @param dialect - Dialeto SQL ('sqlite', 'mysql', 'postgres', 'mssql', 'oracle')
 * @returns Array de objetos com SQL e função de mapeamento para cada dialeto
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const dialect = 'postgres';
 * 
 * // Como usar
 * const queries = namesByDialect(dialect);
 * 
 * // Output: [{ sql: "SELECT table_name FROM information_schema.views...", map: (r) => r.table_name }]
 * ```
 */
function namesByDialect(dialect?: string) {
  switch (dialect) {
    case 'sqlite': return [{ sql: "SELECT name FROM sqlite_master WHERE type='view'", map: (r: any) => r.name }];
    case 'mysql': return [{ sql: "SHOW FULL TABLES WHERE TABLE_TYPE = 'VIEW'", map: (r: any) => Object.values(r)[0] as string }];
    case 'postgres': return [{ sql: "SELECT table_name FROM information_schema.views WHERE table_schema = current_schema()", map: (r: any) => r.table_name }];
    case 'mssql': return [{ sql: "SELECT name FROM sys.views", map: (r: any) => r.name }];
    case 'oracle': return [{ sql: "SELECT VIEW_NAME AS name FROM USER_VIEWS", map: (r: any) => r.name }];
    default:
      return [
        { sql: "SELECT name FROM sqlite_master WHERE type='view'", map: (r: any) => r.name },
        { sql: "SHOW FULL TABLES WHERE TABLE_TYPE = 'VIEW'", map: (r: any) => Object.values(r)[0] as string },
        { sql: "SELECT table_name FROM information_schema.views WHERE table_schema = current_schema()", map: (r: any) => r.table_name },
        { sql: "SELECT name FROM sys.views", map: (r: any) => r.name },
        { sql: "SELECT VIEW_NAME AS name FROM USER_VIEWS", map: (r: any) => r.name },
      ];
  }
}

/**
 * Escapa valores para uso seguro em SQL literals.
 * Converte diferentes tipos de dados para strings SQL válidas.
 * 
 * @param value - Valor a ser escapado
 * @returns String SQL escapada e segura
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const values = [null, 42, 'John\'s data', true, new Date()];
 * 
 * // Como usar
 * const escaped = values.map(escapeSqlLiteral);
 * 
 * // Output: ['NULL', '42', "'John''s data'", '1', "'2024-01-01T00:00:00.000Z'"]
 * ```
 */
function getExec(explicit?: DatabaseExecutor): DatabaseExecutor {
  const exec = explicit || QueryKitConfig.defaultExecutor;
  if (!exec) throw new Error('No executor configured for QueryKit');
  return exec;
}

function dialectOf(exec: DatabaseExecutor): SqlDialect {
  return exec.dialect || QueryKitConfig.defaultDialect || 'sqlite';
}

function dropViewSql(viewName: string, dialect: SqlDialect): string {
  const ident = quoteIdent(viewName, dialect);
  if (dialect === 'oracle') {
    return `BEGIN EXECUTE IMMEDIATE 'DROP VIEW ${ident}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`;
  }
  return `DROP VIEW IF EXISTS ${ident}`;
}

/**
 * Gerenciador de views para o QueryKit.
 * Permite criar, substituir, remover e listar views de banco de dados.
 * Suporta múltiplos dialetos SQL e agendamento de refresh automático.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const viewManager = new ViewManager();
 * const userQuery = table('users').select('id', 'name', 'email').where('active', true);
 * 
 * // Como usar
 * await viewManager.createOrReplaceView('active_users', userQuery);
 * 
 * // Output: View 'active_users' criada com sucesso
 * ```
 */
export class ViewManager {
  /**
   * Cria ou substitui uma view baseada em um QueryBuilder.
   * Remove a view existente se houver e cria uma nova.
   * 
   * @param viewName - Nome da view a ser criada
   * @param query - QueryBuilder que define o conteúdo da view
   * @returns Promise que resolve quando a view for criada
   * @throws Error se não houver executor configurado
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * const productQuery = table('products')
   *   .select('id', 'name', 'price')
   *   .where('category', 'electronics');
   * 
   * // Como usar
   * await viewManager.createOrReplaceView('electronics_products', productQuery);
   * 
   * // Output: View 'electronics_products' criada com produtos da categoria electronics
   * ```
   */
  public async createOrReplaceView(viewName: string, query: QueryBuilder<any>, executor?: DatabaseExecutor): Promise<void> {
    const exec = getExec(executor);
    const dialect = dialectOf(exec);
    const { sql, bindings } = query.toSql();
    await this.dropView(viewName, exec);
    const inlined = inlineBindings(sql, bindings);
    const createViewSql = `CREATE VIEW ${quoteIdent(viewName, dialect)} AS ${inlined}`;
    if (exec.run) await exec.run(createViewSql, []);
    else if (exec.runSync) exec.runSync(createViewSql, []);
    else await exec.executeQuery(createViewSql, []);
  }

  /**
   * Agenda refresh automático de uma view em intervalos regulares.
   * A view será recriada automaticamente usando a query fornecida.
   * 
   * @param viewName - Nome da view para agendar refresh
   * @param query - QueryBuilder para recriar a view
   * @param intervalMs - Intervalo em milissegundos entre refreshes
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * const statsQuery = table('logs').select('date', 'count(*) as total').groupBy('date');
   * 
   * // Como usar
   * viewManager.scheduleViewRefresh('daily_stats', statsQuery, 3600000); // A cada hora
   * 
   * // Output: Refresh da view 'daily_stats' agendado para cada hora
   * ```
   */
  public scheduleViewRefresh(viewName: string, query: QueryBuilder<any>, intervalMs: number): void {
    const task = () => this.createOrReplaceView(viewName, query);
    scheduler.schedule(`refresh-view-${viewName}`, task, intervalMs);
  }

  /**
   * Cancela o refresh automático de uma view.
   * 
   * @param viewName - Nome da view para cancelar refresh
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * viewManager.scheduleViewRefresh('temp_view', query, 5000);
   * 
   * // Como usar
   * viewManager.unscheduleViewRefresh('temp_view');
   * 
   * // Output: Refresh automático da view 'temp_view' cancelado
   * ```
   */
  public unscheduleViewRefresh(viewName: string): void {
    scheduler.unschedule(`refresh-view-${viewName}`);
  }

  /**
   * Remove uma view do banco de dados.
   * Usa DROP VIEW IF EXISTS para evitar erros se a view não existir.
   * 
   * @param viewName - Nome da view a ser removida
   * @returns Promise que resolve quando a view for removida
   * @throws Error se não houver executor configurado
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * 
   * // Como usar
   * await viewManager.dropView('old_view');
   * 
   * // Output: View 'old_view' removida com sucesso
   * ```
   */
  public async dropView(viewName: string, executor?: DatabaseExecutor): Promise<void> {
    const exec = getExec(executor);
    const sql = dropViewSql(viewName, dialectOf(exec));
    if (exec.run) await exec.run(sql, []);
    else if (exec.runSync) exec.runSync(sql, []);
    else await exec.executeQuery(sql, []);
  }

  /**
   * Lista todas as views existentes no banco de dados (síncrono).
   * Tenta diferentes queries baseado no dialeto do executor.
   * 
   * @returns Array com nomes das views existentes
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * 
   * // Como usar
   * const views = viewManager.listViews();
   * 
   * // Output: ['active_users', 'daily_stats', 'product_summary']
   * ```
   */
  public listViews(): string[] {
    const exec = getExec();
    if (!exec.executeQuerySync) return [];
    const candidates = namesByDialect(exec.dialect || (QueryKitConfig as any).defaultDialect);
    for (const c of candidates) {
      try {
        const res = exec.executeQuerySync(c.sql, []);
        const rows = (res?.data as any[]) || [];
        const names = rows.map(c.map).filter(Boolean);
        return names;
      } catch {}
    }
    return [];
  }

  /**
   * Verifica se uma view específica existe (síncrono).
   * 
   * @param viewName - Nome da view para verificar
   * @returns true se a view existir, false caso contrário
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * 
   * // Como usar
   * const exists = viewManager.viewExists('active_users');
   * 
   * // Output: true se a view 'active_users' existir
   * ```
   */
  public viewExists(viewName: string): boolean {
    const names = this.listViews();
    return names.includes(viewName);
  }

  /**
   * Lista todas as views existentes no banco de dados (assíncrono).
   * Versão assíncrona do método listViews().
   * 
   * @returns Promise que resolve com array de nomes das views
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * 
   * // Como usar
   * const views = await viewManager.listViewsAsync();
   * 
   * // Output: Promise resolve com ['active_users', 'daily_stats']
   * ```
   */
  public async listViewsAsync(): Promise<string[]> {
    const exec = getExec();
    if (exec.executeQuerySync) return this.listViews();
    const candidates = namesByDialect(exec.dialect || (QueryKitConfig as any).defaultDialect);
    for (const c of candidates) {
      try {
        const res = await exec.executeQuery(c.sql, []);
        const rows = (res?.data as any[]) || [];
        const names = rows.map(c.map).filter(Boolean);
        return names;
      } catch {}
    }
    return [];
  }

  /**
   * Verifica se uma view específica existe (assíncrono).
   * Versão assíncrona do método viewExists().
   * 
   * @param viewName - Nome da view para verificar
   * @returns Promise que resolve com true se a view existir
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * 
   * // Como usar
   * const exists = await viewManager.viewExistsAsync('active_users');
   * 
   * // Output: Promise resolve com true se a view existir
   * ```
   */
  public async viewExistsAsync(viewName: string): Promise<boolean> {
    const names = await this.listViewsAsync();
    return names.includes(viewName);
  }

  /**
   * Cria um QueryBuilder para uma view existente.
   * Permite fazer queries em views como se fossem tabelas normais.
   * 
   * @param viewName - Nome da view
   * @returns QueryBuilder configurado para a view
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const viewManager = new ViewManager();
   * 
   * // Como usar
   * const viewQuery = viewManager.view('active_users').select('*').limit(10);
   * const results = await viewQuery.execute();
   * 
   * // Output: QueryBuilder configurado para a view 'active_users'
   * ```
   */
  public view<T extends Record<string, any>>(viewName: string): QueryBuilder<T> {
    return table<T>(viewName) as QueryBuilder<T>;
  }
} 