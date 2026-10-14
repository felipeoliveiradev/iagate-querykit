import type { DatabaseExecutor, QueryResult, SqlDialect } from '../types.js';
import { normalizeDialect } from '../sql/dialect.js';

export type DatabaseType = SqlDialect | 'postgresql';

export type { QueryResult };

export interface DatabaseConfig {
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  filePath?: string;
  options?: Record<string, any>;
}

export abstract class BaseDatabaseAdapter implements DatabaseExecutor {
  protected config: DatabaseConfig;
  public readonly dialect: SqlDialect;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.dialect = normalizeDialect(config.type);
  }

  getConfig(): DatabaseConfig {
    return this.config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isConnectedToDatabase(): boolean;
  abstract executeQuery(sql: string, params?: any[]): Promise<QueryResult>;

  async close(): Promise<void> {
    await this.disconnect();
  }

  async backup(_destPath: string): Promise<void> {
    throw new Error('backup() is not implemented by this adapter');
  }
  async restore(_srcPath: string): Promise<void> {
    throw new Error('restore() is not implemented by this adapter');
  }
  async getConnectionInfo(): Promise<{ uptime: number; activeConnections: number }> {
    throw new Error('getConnectionInfo() is not implemented by this adapter');
  }
}

export function isDatabaseExecutor(value: unknown): value is DatabaseExecutor {
  return !!value && typeof (value as any).executeQuery === 'function';
}
