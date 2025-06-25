import { describe, it, expect } from 'vitest';
import { MultiDatabaseManager, type MultiDatabaseConfig } from '../database-manager';
import { BaseDatabaseAdapter, type DatabaseConfig } from '../database-adapters/base-adapter';

class MockAdapter extends BaseDatabaseAdapter {
  connected = false;
  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }
  isConnectedToDatabase(): boolean { return this.connected; }
  async executeQuery(sql: string, params?: any[]) { return { data: [{ ok: 1 }] }; }
}

describe('MultiDatabaseManager', () => {
  it('initializes and executes on multiple databases', async () => {
    const cfg: MultiDatabaseConfig = {
      defaultDatabase: 'db1',
      databases: {
        db1: { name: 'db1', type: 'sqlite' },
        db2: { name: 'db2', type: 'sqlite' }
      }
    };
    const mdm = MultiDatabaseManager.getInstance(cfg);
    await mdm.initialize((c: DatabaseConfig) => new MockAdapter(c));
    const results = await mdm.executeOnMultiple(['db1','db2'], 'SELECT 1');
    expect(Object.keys(results)).toEqual(['db1','db2']);
  });
}); 