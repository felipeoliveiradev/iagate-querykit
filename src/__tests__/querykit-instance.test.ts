import { describe, it, expect, afterEach } from 'vitest';
import { createQueryKit } from '../querykit.js';
import { QueryBuilder } from '../query-builder.js';
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js';
import { resetQueryKitConfig } from '../config.js';

describe('createQueryKit (instance API)', () => {
  const kits: Array<{ close: () => void }> = [];
  afterEach(() => {
    for (const k of kits) k.close();
    kits.length = 0;
    resetQueryKitConfig();
  });

  it('runs queries without a global default executor', async () => {
    const exec = new BetterSqlite3Executor(':memory:');
    const kit = createQueryKit(exec);
    kits.push(kit);
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password TEXT)');
    await kit.table('users').insert({ email: 'a@x.com', password: 'secret' }).make();
    const rows = await kit.table<{ email: string; password: string }>('users').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('a@x.com');
  });

  it('selectAllExcept expands via PRAGMA and omits columns', async () => {
    const exec = new BetterSqlite3Executor(':memory:');
    const kit = createQueryKit(exec);
    kits.push(kit);
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password TEXT)');
    await kit.table('users').insert({ email: 'a@x.com', password: 'secret' }).make();
    const rows = await kit.table('users').selectAllExcept(['password']).all();
    expect(rows[0]).toHaveProperty('email');
    expect(rows[0]).not.toHaveProperty('password');
  });

  it('pluck does not mutate the original select list', async () => {
    const exec = new BetterSqlite3Executor(':memory:');
    const kit = createQueryKit(exec);
    kits.push(kit);
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
    await kit.table('users').insert({ email: 'a@x.com' }).make();
    const qb = kit.table('users').select(['id', 'email']);
    const emails = await qb.pluck('email');
    expect(emails).toEqual(['a@x.com']);
    const { sql } = qb.toSql();
    expect(sql).toMatch(/"id"/);
    expect(sql).toMatch(/"email"/);
  });

  it('scalar() returns the first column of the first row', async () => {
    const exec = new BetterSqlite3Executor(':memory:');
    const kit = createQueryKit(exec);
    kits.push(kit);
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
    await kit.table('users').insert({ email: 'a@x.com' }).make();
    const n = await kit.table('users').count().scalar<number>('count');
    expect(n).toBe(1);
  });

  it('transaction() binds a kit to the same connection', async () => {
    const exec = new BetterSqlite3Executor(':memory:');
    const kit = createQueryKit(exec);
    kits.push(kit);
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
    await kit.transaction(async (tx) => {
      await tx.table('users').insert({ email: 'tx@x.com' }).make();
    });
    const rows = await kit.table('users').all();
    expect(rows).toHaveLength(1);
  });

  it('use() binds an executor on an existing builder', async () => {
    const exec = new BetterSqlite3Executor(':memory:');
    kits.push({ close: () => exec.close() });
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
    await new QueryBuilder('users').use(exec).insert({ email: 'use@x.com' }).make();
    const rows = await new QueryBuilder('users').use(exec).all();
    expect(rows[0].email).toBe('use@x.com');
  });

  it('rejects a kit without dialect', () => {
    expect(() => createQueryKit({ executeQuery: async () => ({ data: [] }) } as any)).toThrow(/dialect/);
  });
});
