import { describe, it, expect, afterEach } from 'vitest';
import { QueryBuilder, raw, table, Model, scheduler, parallel, simulationManager } from '../index.js';
import { createQueryKit } from '../querykit.js';
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js';
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js';
import { ViewManager } from '../view-manager.js';
import { TriggerManager } from '../trigger-manager.js';
import { MultiDatabaseManager } from '../database-manager.js';

function sqlite() {
  const exec = new BetterSqlite3Executor(':memory:');
  exec.executeQuerySync(
    'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, active INTEGER, created_at TEXT)',
  );
  exec.executeQuerySync('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER, user_id INTEGER, updated_at TEXT)');
  exec.executeQuerySync('CREATE TABLE events (user_id INTEGER, timestamp TEXT)');
  exec.executeQuerySync('CREATE TABLE logins (id INTEGER PRIMARY KEY, created_at TEXT)');
  exec.executeQuerySync('CREATE TABLE audit (msg TEXT)');
  return exec;
}

describe('README / docs examples run as tests', () => {
  afterEach(() => {
    resetQueryKitConfig();
    MultiDatabaseManager.resetInstance();
    scheduler.clear();
    simulationManager.stop();
  });

  it('createQueryKit preferred setup', async () => {
    const exec = sqlite();
    exec.executeQuerySync("INSERT INTO users (email, active) VALUES ('a@x.com', 1)");
    const kit = createQueryKit(exec);
    const users = await kit.table('users').where('active', '=', 1).all();
    expect(users).toHaveLength(1);
    await kit.close();
  });

  it('queries catalog: select/where/order/limit, count, insert/update/delete', async () => {
    const exec = sqlite();
    setDefaultExecutor(exec);
    await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make();
    const users = await new QueryBuilder<{ id: number; email: string; active: number }>('users')
      .select(['id', 'email'])
      .where('active', '=', 1)
      .orderBy('id', 'DESC')
      .limit(50)
      .all();
    expect(users[0].email).toBe('a@b.com');
    const total = new QueryBuilder('users').count().scalarSync<number>('count');
    expect(total).toBe(1);
    await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make();
    await new QueryBuilder('users').where('id', '=', 1).delete().make();
    expect(await new QueryBuilder('users').all()).toEqual([]);
    exec.close();
  });

  it('raw / IN / NULL / BETWEEN / EXISTS', async () => {
    const exec = sqlite();
    setDefaultExecutor(exec);
    exec.executeQuerySync("INSERT INTO users (id, email, active, created_at) VALUES (1, 'a@x.com', 1, '2025-06-01')");
    exec.executeQuerySync('INSERT INTO orders (id, amount, user_id) VALUES (1, 10, 1)');
    const rows = await new QueryBuilder('users')
      .select(['id'])
      .whereIn('id', [1, 2, 3])
      .whereNotNull('email')
      .whereBetween('created_at', ['2025-01-01', '2025-12-31'])
      .selectRaw("strftime('%Y-%m', created_at) AS ym")
      .all();
    expect(rows.length).toBeGreaterThan(0);
    const monthly = await new QueryBuilder('users')
      .selectRaw("strftime('%Y-%m', created_at) AS ym")
      .groupBy("strftime('%Y-%m', created_at)")
      .havingRaw('COUNT(id) > 0')
      .all();
    expect(monthly.length).toBeGreaterThan(0);
    const sub = new QueryBuilder('orders').select(['user_id']).where('amount', '>', 0);
    expect(await new QueryBuilder('users').whereExists(sub).limit(1).exists()).toBe(true);
    void raw;
    exec.close();
  });

  it('views + scheduler + triggers (valid SQLite body)', async () => {
    const exec = sqlite();
    setDefaultExecutor(exec);
    exec.executeQuerySync("INSERT INTO users (email, active) VALUES ('a@x.com', 1)");
    const views = new ViewManager();
    await views.createOrReplaceView(
      'active_users',
      new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1),
    );
    expect(views.viewExists('active_users')).toBe(true);
    views.scheduleViewRefresh(
      'active_users',
      new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1),
      10 * 60 * 1000,
    );
    views.unscheduleViewRefresh('active_users');

    const triggers = new TriggerManager();
    triggers.createTrigger(
      'users_ai',
      'users',
      'AFTER',
      'INSERT',
      `INSERT INTO audit (msg) VALUES ('ins')`,
    );
    exec.executeQuerySync("INSERT INTO users (email, active) VALUES ('b@x.com', 1)");
    expect(exec.executeQuerySync('SELECT msg FROM audit').data[0].msg).toBe('ins');
    exec.close();
  });

  it('scheduler list/clear', () => {
    scheduler.schedule('nightly-maintenance', () => {}, 24 * 60 * 60 * 1000);
    expect(scheduler.list()).toContain('nightly-maintenance');
    scheduler.clear();
    expect(scheduler.list()).toEqual([]);
  });

  it('parallel reads', async () => {
    const exec = sqlite();
    setDefaultExecutor(exec);
    exec.executeQuerySync("INSERT INTO users (email, active) VALUES ('a@x.com', 1)");
    exec.executeQuerySync('INSERT INTO orders (amount) VALUES (99)');
    const [recentUsers, topOrders] = await parallel(
      new QueryBuilder('users').select(['id']).orderBy('id', 'DESC').limit(10),
      new QueryBuilder('orders').select(['id']).orderBy('amount', 'DESC').limit(5),
    );
    expect(recentUsers.length).toBe(1);
    expect(topOrders.length).toBe(1);
    exec.close();
  });

  it('simulation dry-run from README', async () => {
    await simulationManager.start({
      users: [
        { id: 1, email: 'a@b.com', active: 1 },
        { id: 2, email: 'c@d.com', active: 0 },
      ],
    });
    const q = new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1).limit(1);
    const one = await q.all<{ id: number; email: string }>();
    expect(one[0].email).toBe('a@b.com');
    simulationManager.stop();
  });

  it('multi-database fan-out', async () => {
    const multi = MultiDatabaseManager.getInstance({
      defaultDatabase: 'primary',
      databases: {
        primary: { name: 'primary', type: 'sqlite', filePath: ':memory:' },
        analytics: { name: 'analytics', type: 'sqlite', filePath: ':memory:' },
      },
    });
    await multi.initialize(({ filePath }) => new BetterSqlite3Executor(filePath!));
    for (const name of ['primary', 'analytics']) {
      await multi.getAdapter(name).executeQuery('CREATE TABLE users (id INTEGER)');
      await multi.getAdapter(name).executeQuery('INSERT INTO users (id) VALUES (1)');
    }
    const results = await multi.executeOnMultiple(['primary', 'analytics'], 'SELECT COUNT(*) as c FROM users');
    expect(results.primary.data[0].c).toBe(1);
    expect(results.analytics.data[0].c).toBe(1);
    await multi.close();
  });

  it('transaction example', async () => {
    const exec = sqlite();
    await exec.transaction(async (tx) => {
      await tx.executeQuery('INSERT INTO users (email) VALUES (?)', ['a@b.com']);
      await tx.executeQuery('INSERT INTO audit (msg) VALUES (?)', ['created']);
    });
    expect(exec.executeQuerySync('SELECT COUNT(*) AS c FROM users').data[0].c).toBe(1);
    exec.close();
  });

  it('union + paginate compiles', () => {
    const a = new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1);
    const b = new QueryBuilder('users').select(['id', 'email']).where('active', '=', 0);
    const { sql, bindings } = a.unionAll(b).orderBy('id', 'DESC').paginate(2, 10).toSql();
    expect(sql).toMatch(/UNION ALL/);
    expect(sql).toMatch(/LIMIT \?/);
    expect(bindings.length).toBeGreaterThanOrEqual(3);
  });

  it('aggregations with CASE', () => {
    const q = new QueryBuilder('users').selectCount('*', 'total').selectCaseSum('active = 1', 'active_count');
    const { sql } = q.toSql();
    expect(sql).toMatch(/COUNT\(\*\) AS "total"/);
    expect(sql).toMatch(/SUM\(CASE WHEN active = 1 THEN 1 ELSE 0 END\) AS "active_count"/);
  });

  it('range and period helpers bind ISO timestamps', () => {
    const last7d = new QueryBuilder('logins').period('created_at', '7d').select(['id']);
    const { sql, bindings } = last7d.toSql();
    expect(sql).toMatch(/"created_at" >= \?/);
    expect(typeof bindings[0]).toBe('string');
    expect(bindings[0]).toMatch(/^\d{4}-/);
  });

  it('model fillable/guarded + table helper', async () => {
    const exec = sqlite();
    setDefaultExecutor(exec);
    class User extends Model {
      protected static tableName = 'users';
      protected fillable = ['email', 'active'];
    }
    const u = new User();
    u.fill({ id: 999, email: 'x@y.com', active: 1 } as any);
    await u.save();
    const row = exec.executeQuerySync('SELECT * FROM users').data[0];
    expect(row.email).toBe('x@y.com');
    expect(row.id).not.toBe(999);
    const first = table<{ id: number; email: string }>('users').orderBy('id', 'ASC').firstSync();
    expect(first?.email).toBe('x@y.com');
    exec.close();
  });
});
