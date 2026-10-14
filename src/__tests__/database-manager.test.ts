import { describe, it, expect, beforeEach } from 'vitest';
import { MultiDatabaseManager, type MultiDatabaseConfig } from '../database-manager';
import { BaseDatabaseAdapter, type DatabaseConfig } from '../database-adapters/base-adapter';

class MockAdapter extends BaseDatabaseAdapter {
  connected = false;
  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }
  isConnectedToDatabase(): boolean { return this.connected; }
  async executeQuery(sql: string, params?: any[]) { return { data: [{ ok: 1 }] }; }
}

class FailingAdapter extends BaseDatabaseAdapter {
  async connect() {}
  async disconnect() {}
  isConnectedToDatabase(): boolean { return true }
  async executeQuery(sql: string, params?: any[]) { throw new Error('fail'); return { data: [] } as any }
}

describe('MultiDatabaseManager', () => {
  beforeEach(() => MultiDatabaseManager.resetInstance());

  it('throws when getInstance is called with no config before init', () => {
    expect(() => MultiDatabaseManager.getInstance()).toThrow(/not initialized/);
  });

  it('accepts a DatabaseExecutor factory (README BetterSqlite3Executor shape)', async () => {
    const cfg: MultiDatabaseConfig = {
      defaultDatabase: 'primary',
      databases: { primary: { name: 'primary', type: 'sqlite', filePath: ':memory:' } },
    };
    const mdm = MultiDatabaseManager.getInstance(cfg);
    const exec = {
      dialect: 'sqlite' as const,
      executeQuery: async () => ({ data: [{ c: 1 }] }),
    };
    await mdm.initialize(() => exec as any);
    const out = await mdm.executeOnMultiple(['primary'], 'SELECT 1');
    expect(out.primary.data[0].c).toBe(1);
  });

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

  it('getDefaultAdapter returns adapter for default database', async () => {
    const cfg: MultiDatabaseConfig = {
      defaultDatabase: 'main',
      databases: { main: { name: 'main', type: 'sqlite' } }
    }
    const mdm = MultiDatabaseManager.getInstance(cfg);
    await mdm.initialize((c: DatabaseConfig) => new MockAdapter(c));
    const a = mdm.getDefaultAdapter()
    expect(a.isConnectedToDatabase()).toBe(true)
  })

  it('executeOnMultiple captures per-db errors into metadata', async () => {
    const cfg: MultiDatabaseConfig = {
      defaultDatabase: 'ok',
      databases: { ok: { name: 'ok', type: 'sqlite' }, bad: { name: 'bad', type: 'sqlite' } }
    }
    const mdm = MultiDatabaseManager.getInstance(cfg);
    await mdm.initialize((c: DatabaseConfig) => (c.name === 'bad' ? new FailingAdapter(c) : new MockAdapter(c)));
    const out = await mdm.executeOnMultiple(['ok','bad'], 'SELECT 1') as any
    expect(out.ok.data).toBeDefined()
    expect(out.bad.metadata.error).toBeDefined()
  })
}); 