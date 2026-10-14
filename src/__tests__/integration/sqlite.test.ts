import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { QueryBuilder } from '../../query-builder.js';
import { table } from '../../table.js';
import { BetterSqlite3Executor } from '../../adapters/better-sqlite3.js';
import { ViewManager } from '../../view-manager.js';
import { TriggerManager } from '../../trigger-manager.js';
import { migrateUp, resetMigrations } from '../../migration-manager.js';
import { migration, ColumnType } from '../../migration-dsl.js';
import { runSeed } from '../../seed.js';

let BetterSqlite3: any;
try {
  BetterSqlite3 = (await import('better-sqlite3')).default;
} catch {
  BetterSqlite3 = null;
}

const describeSqlite = BetterSqlite3 ? describe : describe.skip;

describeSqlite('sqlite integration', () => {
  let exec: BetterSqlite3Executor;
  let raw: any;

  beforeEach(() => {
    resetQueryKitConfig();
    raw = new BetterSqlite3(':memory:');
    exec = new BetterSqlite3Executor(raw);
    setDefaultExecutor(exec);
    raw.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, active INTEGER, meta TEXT)');
  });

  afterEach(() => {
    exec.close();
    resetQueryKitConfig();
  });

  it('round-trips insert/select/update/delete with bindings', async () => {
    const ins = await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make();
    expect(ins.changes).toBe(1);
    expect(Number(ins.lastInsertRowid)).toBeGreaterThan(0);

    const rows = await table('users').where('active', '=', 1).all<{ email: string }>();
    expect(rows).toEqual([{ id: 1, email: 'a@b.com', active: 1, meta: null }].map((r) => expect.objectContaining({ email: r.email })));

    const first = await new QueryBuilder('users').where('email', '=', 'a@b.com').first<{ id: number }>();
    expect(first?.id).toBe(1);

    await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make();
    expect(await new QueryBuilder('users').where('active', '=', 1).exists()).toBe(false);

    await new QueryBuilder('users').where('id', '=', 1).delete().make();
    expect(await new QueryBuilder('users').all()).toEqual([]);
  });

  it('inserts multiple rows in one statement', async () => {
    const res = await new QueryBuilder('users').insert([
      { email: 'one@x.com', active: 1 },
      { email: 'two@x.com', active: 1 },
    ]).make();
    expect(res.changes).toBe(2);
    expect((await new QueryBuilder('users').all()).length).toBe(2);
  });

  it('rejects identifier injection at compile time', () => {
    expect(() => new QueryBuilder('users;drop table users--').toSql()).toThrow(/Unsafe SQL identifier/);
  });

  it('enables foreign keys (C10)', () => {
    const r = exec.executeQuerySync('PRAGMA foreign_keys');
    expect(r.data[0].foreign_keys).toBe(1);
  });

  it('runs a transaction that rolls back', async () => {
    await exec.transaction(async (tx) => {
      await tx.run!('INSERT INTO users (email, active) VALUES (?, ?)', ['tx@x.com', 1]);
      throw new Error('boom');
    }).catch((e) => e);
    expect(raw.prepare('SELECT COUNT(*) AS c FROM users').get().c).toBe(0);
  });

  it('creates a view and queries it', async () => {
    await new QueryBuilder('users').insert({ email: 'v@x.com', active: 1 }).make();
    const views = new ViewManager();
    await views.createOrReplaceView('active_users', new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1));
    expect(views.viewExists('active_users')).toBe(true);
    const rows = await views.view('active_users').all<{ email: string }>();
    expect(rows[0]?.email).toBe('v@x.com');
    await views.dropView('active_users');
  });

  it('creates a sqlite trigger', () => {
    raw.exec('CREATE TABLE audit (msg TEXT)');
    const tm = new TriggerManager();
    tm.createTrigger('users_ai', 'users', 'AFTER', 'INSERT', `INSERT INTO audit (msg) VALUES ('ins')`);
    raw.prepare('INSERT INTO users (email, active) VALUES (?, ?)').run('t@x.com', 1);
    expect(raw.prepare('SELECT msg FROM audit').get().msg).toBe('ins');
    tm.dropTrigger('users_ai');
  });

  it('applies a DSL migration and seeds', async () => {
    raw.exec('DROP TABLE users');
    await resetMigrations({ executor: exec });
    await migrateUp([
      {
        id: '001_items',
        up: migration((b) => {
          b.createTable('items', {
            id: { type: ColumnType.Int, primaryKey: true, autoIncrement: true },
            name: { type: ColumnType.String, notNull: true },
          });
        }),
      },
    ], { executor: exec });
    const n = await runSeed('items', [{ name: 'alpha' }, { name: 'beta' }]);
    expect(n).toBe(2);
    expect((await new QueryBuilder('items').all()).length).toBe(2);
  });
});
