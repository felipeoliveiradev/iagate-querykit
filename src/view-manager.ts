import { QueryKitConfig } from './config';
import type { QueryBuilder } from './query-builder';
import { scheduler } from './scheduler';

export class ViewManager {
  public createOrReplaceView(viewName: string, query: QueryBuilder<any>): void {
    const { sql, bindings } = query.toSql();
    this.dropView(viewName);
    const createViewSql = `CREATE VIEW ${viewName} AS ${sql}`;
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit');
    exec.runSync(createViewSql, bindings);
  }

  public scheduleViewRefresh(viewName: string, query: QueryBuilder<any>, intervalMs: number): void {
    const task = () => this.createOrReplaceView(viewName, query);
    scheduler.schedule(`refresh-view-${viewName}`, task, intervalMs);
  }

  public unscheduleViewRefresh(viewName: string): void {
    scheduler.unschedule(`refresh-view-${viewName}`);
  }

  public dropView(viewName: string): void {
    const dropViewSql = `DROP VIEW IF EXISTS ${viewName}`;
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.runSync) throw new Error('No executor configured for QueryKit');
    exec.runSync(dropViewSql, []);
  }

  public listViews(): string[] {
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const rows = exec.executeQuerySync("SELECT name FROM sqlite_master WHERE type='view'", []).data as any[];
    return rows.map(row => row.name);
  }

  public viewExists(viewName: string): boolean {
    const exec = QueryKitConfig.defaultExecutor;
    if (!exec || !exec.executeQuerySync) throw new Error('No executor configured for QueryKit');
    const row = exec.executeQuerySync("SELECT name FROM sqlite_master WHERE type='view' AND name= ?", [viewName]).data[0];
    return !!row;
  }

  public view<T extends Record<string, any>>(viewName: string): QueryBuilder<T> {
    const tableFactory: any = (QueryKitConfig as any).table;
    return tableFactory(viewName) as QueryBuilder<T>;
  }
} 