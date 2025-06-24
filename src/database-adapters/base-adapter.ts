export type DatabaseType = 'sqlite' | 'mysql' | 'postgresql' | 'mongodb' | 'redis' | 'firebase' | 'cassandra' | 'hbase' | 'couchbase' | 'hadoop' | 'spark';

export type QueryResult = { data: any[]; affectedRows?: number; lastInsertId?: number | string; metadata?: Record<string, any> };

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

export abstract class BaseDatabaseAdapter {
  protected config: DatabaseConfig;
  constructor(config: DatabaseConfig) { this.config = config; }
  getConfig(): DatabaseConfig { return this.config; }
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isConnectedToDatabase(): boolean;
  abstract executeQuery(sql: string, params?: any[]): Promise<QueryResult>;
  async backup(destPath: string): Promise<void> { return; }
  async restore(srcPath: string): Promise<void> { return; }
  async getConnectionInfo(): Promise<{ uptime: number; activeConnections: number }> { return { uptime: 0, activeConnections: 0 }; }
} 