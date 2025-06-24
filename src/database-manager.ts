import { BaseDatabaseAdapter, type DatabaseConfig, type QueryResult } from './database-adapters/base-adapter';

export interface MultiDatabaseConfig {
  defaultDatabase: string;
  databases: Record<string, DatabaseConfig>;
}

export class MultiDatabaseManager {
  private static instance: MultiDatabaseManager;
  private adapters: Map<string, BaseDatabaseAdapter> = new Map();
  private config: MultiDatabaseConfig;

  private constructor(config: MultiDatabaseConfig) {
    this.config = config;
  }

  static getInstance(config?: MultiDatabaseConfig) {
    if (!MultiDatabaseManager.instance && config) {
      MultiDatabaseManager.instance = new MultiDatabaseManager(config);
    }
    return MultiDatabaseManager.instance;
  }

  async initialize(createAdapter: (config: DatabaseConfig) => BaseDatabaseAdapter) {
    for (const [name, dbConfig] of Object.entries(this.config.databases)) {
      const adapter = createAdapter(dbConfig);
      await adapter.connect();
      this.adapters.set(name, adapter);
    }
  }

  getAdapter(name: string): BaseDatabaseAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`Database adapter '${name}' not found`);
    return adapter;
  }

  getDefaultAdapter(): BaseDatabaseAdapter { return this.getAdapter(this.config.defaultDatabase); }

  async executeOnMultiple(databaseNames: string[], query: string, params?: any[]): Promise<Record<string, QueryResult>> {
    const results: Record<string, QueryResult> = {};
    await Promise.all(databaseNames.map(async (name) => {
      try {
        const adapter = this.getAdapter(name);
        results[name] = await adapter.executeQuery(query, params);
      } catch (error) {
        results[name] = { data: [], metadata: { error: (error as Error).message } } as any;
      }
    }));
    return results;
  }
} 