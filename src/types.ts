import type { SqlDialect } from './sql/dialect.js';

export type { SqlDialect } from './sql/dialect.js';

/**
 * Result of a query executed against a database.
 */
export type QueryResult = {
  data: any[];
  affectedRows?: number;
  lastInsertId?: number | string | bigint;
  metadata?: Record<string, any>;
};

export type WriteResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

/**
 * Contract implemented by every first-party executor.
 * Bindings are always positional `?` at this layer; adapters convert
 * placeholders for the target driver without touching literals.
 */
export interface DatabaseExecutor {
  readonly dialect: SqlDialect;
  executeQuery(sql: string, bindings?: any[]): Promise<QueryResult>;
  executeQuerySync?(sql: string, bindings?: any[]): QueryResult;
  run?(sql: string, bindings?: any[]): Promise<WriteResult>;
  runSync?(sql: string, bindings?: any[]): WriteResult;
  close?(): Promise<void> | void;
  transaction?<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T>;
}

export interface EventBus {
  emit(event: string, ...payload: any[]): void;
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

export type RelationKind = 'hasMany' | 'belongsTo' | 'manyToMany';

export type RelationDefinition = {
  name: string;
  kind: RelationKind;
  table: string;
  localKey?: string;
  foreignKey?: string;
  ownerKey?: string;
  through?: { table: string; leftKey: string; rightKey: string };
};

export type RelationsRegistry = Record<string, RelationDefinition[]>;
