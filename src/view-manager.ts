import { QueryKitConfig } from './config';
import type { QueryBuilder } from './query-builder';
import { scheduler } from './scheduler';

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

export class ViewManager {
  public async createOrReplaceView(viewName: string, query: QueryBuilder<any>): Promise<void> {
    const { sql, bindings } = query.toSql();
    await this.dropView(viewName);
    const createViewSql = `CREATE VIEW ${viewName} AS ${sql}`;
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (exec.runSync) exec.runSync(createViewSql, bindings);
    else await exec.executeQuery(createViewSql, bindings);
  }

  public scheduleViewRefresh(viewName: string, query: QueryBuilder<any>, intervalMs: number): void {
    const task = () => this.createOrReplaceView(viewName, query);
    scheduler.schedule(`refresh-view-${viewName}`, task, intervalMs);
  }

  public unscheduleViewRefresh(viewName: string): void {
    scheduler.unschedule(`refresh-view-${viewName}`);
  }

  public async dropView(viewName: string): Promise<void> {
    const dropViewSql = `DROP VIEW IF EXISTS ${viewName}`;
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (exec.runSync) exec.runSync(dropViewSql, []);
    else await exec.executeQuery(dropViewSql, []);
  }

  public listViews(): string[] {
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (!exec.executeQuerySync) return [];
    const candidates = namesByDialect(exec.dialect || (QueryKitConfig as any).defaultDialect);
    for (const c of candidates) {
      try {
        const res = exec.executeQuerySync(c.sql, []);
        const rows = (res?.data as any[]) || [];
        const names = rows.map(c.map).filter(Boolean);
        if (names.length || rows.length >= 0) return names;
      } catch {}
    }
    return [];
  }

  public viewExists(viewName: string): boolean {
    const names = this.listViews();
    return names.includes(viewName);
  }

  public async listViewsAsync(): Promise<string[]> {
    const exec = QueryKitConfig.defaultExecutor as any;
    if (!exec) throw new Error('No executor configured for QueryKit');
    if (exec.executeQuerySync) return this.listViews();
    const candidates = namesByDialect(exec.dialect || (QueryKitConfig as any).defaultDialect);
    for (const c of candidates) {
      try {
        const res = await exec.executeQuery(c.sql, []);
        const rows = (res?.data as any[]) || [];
        const names = rows.map(c.map).filter(Boolean);
        if (names.length || rows.length >= 0) return names;
      } catch {}
    }
    return [];
  }

  public async viewExistsAsync(viewName: string): Promise<boolean> {
    const names = await this.listViewsAsync();
    return names.includes(viewName);
  }

  public view<T extends Record<string, any>>(viewName: string): QueryBuilder<T> {
    const tableFactory: any = (QueryKitConfig as any).table;
    return tableFactory(viewName) as QueryBuilder<T>;
  }
} 