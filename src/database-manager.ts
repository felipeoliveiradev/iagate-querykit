import { BaseDatabaseAdapter, isDatabaseExecutor, type DatabaseConfig, type QueryResult } from './database-adapters/base-adapter.js';
import type { DatabaseExecutor, MultiDbRegistry } from './types.js';

export interface MultiDatabaseConfig {
  defaultDatabase: string;
  databases: Record<string, DatabaseConfig>;
}

export type AdapterOrExecutor = BaseDatabaseAdapter | DatabaseExecutor;

export class MultiDatabaseManager implements MultiDbRegistry {
  private static instance: MultiDatabaseManager | undefined;
  private adapters: Map<string, AdapterOrExecutor> = new Map();
  private config: MultiDatabaseConfig;

  private constructor(config: MultiDatabaseConfig) {
    this.config = config;
  }

  static getInstance(config?: MultiDatabaseConfig): MultiDatabaseManager {
    if (!MultiDatabaseManager.instance) {
      if (!config) {
        throw new Error('MultiDatabaseManager is not initialized. Pass a config on the first getInstance() call.');
      }
      MultiDatabaseManager.instance = new MultiDatabaseManager(config);
    }
    return MultiDatabaseManager.instance;
  }

  static resetInstance(): void {
    MultiDatabaseManager.instance = undefined;
  }

  async initialize(
    createAdapter: (config: DatabaseConfig) => AdapterOrExecutor | Promise<AdapterOrExecutor>,
  ): Promise<void> {
    for (const [name, dbConfig] of Object.entries(this.config.databases)) {
      const adapter = await createAdapter({ ...dbConfig, name: dbConfig.name || name });
      if (adapter instanceof BaseDatabaseAdapter) {
        await adapter.connect();
      }
      this.adapters.set(name, adapter);
    }
  }

  register(name: string, executor: AdapterOrExecutor): void {
    this.adapters.set(name, executor);
  }

  getAdapter(name: string): DatabaseExecutor {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`Database adapter '${name}' not found`);
    if (!isDatabaseExecutor(adapter)) {
      throw new Error(`Database adapter '${name}' does not implement executeQuery`);
    }
    return adapter;
  }

  getDefaultAdapter(): DatabaseExecutor {
    return this.getAdapter(this.config.defaultDatabase);
  }

  async executeOnMultiple(databaseNames: string[], query: string, params?: any[]): Promise<Record<string, QueryResult>> {
    const results: Record<string, QueryResult> = {};
    await Promise.all(databaseNames.map(async (name) => {
      try {
        const adapter = this.getAdapter(name);
        results[name] = await adapter.executeQuery(query, params);
      } catch (error) {
        results[name] = { data: [], metadata: { error: (error as Error).message } };
      }
    }));
    return results;
  }

  async close(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      if (typeof adapter.close === 'function') {
        await adapter.close();
      } else if (adapter instanceof BaseDatabaseAdapter) {
        await adapter.disconnect();
      }
    }
    this.adapters.clear();
  }
}
