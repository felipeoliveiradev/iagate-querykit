export type QueryResult = { data: any[]; affectedRows?: number; lastInsertId?: number | string };

export interface DatabaseExecutor {
  executeQuery(sql: string, bindings: any[]): Promise<QueryResult>;
  executeQuerySync?(sql: string, bindings: any[]): QueryResult;
  run?(sql: string, bindings: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  runSync?(sql: string, bindings: any[]): { changes: number; lastInsertRowid: number | bigint };
  dialect?: 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle';
}

export interface EventBus {
  emit(event: string, payload?: any): void;
}

export interface SimulationController {
  isActive(): boolean;
  getStateFor(tableName: string): any[] | undefined;
  updateStateFor(tableName: string, data: any[]): void;
  start(initialState: Record<string, any[] | any>): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface MultiDbRegistry {
  getAdapter(databaseName: string): DatabaseExecutor;
} 