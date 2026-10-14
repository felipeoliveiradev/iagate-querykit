import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { QueryBuilder } from '../../query-builder.js';
import { PostgresExecutor } from '../../adapters/postgresql.js';

const host = process.env.POSTGRES_HOST || '127.0.0.1';
const describePg = describe;

describePg('postgres integration', () => {
  let exec: PostgresExecutor;

  beforeAll(async () => {
    resetQueryKitConfig();
    exec = new PostgresExecutor({
      host,
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
    setDefaultExecutor(exec);
    await exec.executeQuery('DROP TABLE IF EXISTS qk_users', []);
    await exec.executeQuery(
      'CREATE TABLE qk_users (id SERIAL PRIMARY KEY, email TEXT, active INT)',
      [],
    );
  });

  afterAll(async () => {
    try {
      await exec.executeQuery('DROP TABLE IF EXISTS qk_users', []);
    } finally {
      await exec.close();
      resetQueryKitConfig();
    }
  });

  it('inserts, selects, updates, deletes with $n conversion', async () => {
    const ins = await new QueryBuilder('qk_users').insert({ email: 'pg@x.com', active: 1 }).make();
    expect(ins.changes).toBeGreaterThanOrEqual(1);

    const row = await new QueryBuilder('qk_users').where('email', '=', 'pg@x.com').first<{ id: number; email: string }>();
    expect(row?.email).toBe('pg@x.com');
    expect(row?.id).toBeTruthy();

    await new QueryBuilder('qk_users').where('id', '=', row!.id).update({ active: 0 }).make();
    const updated = await new QueryBuilder('qk_users').where('id', '=', row!.id).first<{ active: number }>();
    expect(Number(updated?.active)).toBe(0);

    await new QueryBuilder('qk_users').where('id', '=', row!.id).delete().make();
    expect(await new QueryBuilder('qk_users').where('id', '=', row!.id).exists()).toBe(false);
  });

  it('handles reserved words, empty IN, null, JSON, pagination, concurrent reads', async () => {
    await exec.executeQuery('DROP TABLE IF EXISTS "order"', []);
    await exec.executeQuery('CREATE TABLE "order" (id SERIAL PRIMARY KEY, "select" TEXT, meta JSONB, deleted_at TEXT)', []);
    await new QueryBuilder('order').insert({ select: 'ok', meta: { a: 1 } }).make();
    const row = await new QueryBuilder('order').where('select', '=', 'ok').first<any>();
    expect(row.select).toBe('ok');
    expect(await new QueryBuilder('order').whereIn('id', []).all()).toEqual([]);
    expect(await new QueryBuilder('order').where('deleted_at', null).all()).toHaveLength(1);
    const page = await new QueryBuilder('order').orderBy('id').paginate(1, 10).all();
    expect(page).toHaveLength(1);
    const concurrent = await Promise.all([
      new QueryBuilder('order').where('id', '=', row.id).first(),
      new QueryBuilder('order').where('id', '=', row.id).first(),
    ]);
    expect(concurrent[0]?.id).toBe(row.id);
    expect(concurrent[1]?.id).toBe(row.id);
  });

  it('offset without limit, upsert, and JSON containment', async () => {
    await exec.executeQuery('DROP TABLE IF EXISTS qk_extra', []);
    await exec.executeQuery(
      'CREATE TABLE qk_extra (id SERIAL PRIMARY KEY, email TEXT UNIQUE, meta JSONB)',
      [],
    );
    await new QueryBuilder('qk_extra').insert({ email: 'a@pg.com', meta: { a: 1 } }).make();
    await new QueryBuilder('qk_extra').insert({ email: 'b@pg.com', meta: { a: 2 } }).make();
    const skipped = await new QueryBuilder('qk_extra').orderBy('id').offset(1).all<any>();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].email).toBe('b@pg.com');

    await new QueryBuilder('qk_extra').updateOrInsert({ email: 'a@pg.com' }, { meta: { a: 9 } }).make();
    const updated = await new QueryBuilder('qk_extra').where('email', '=', 'a@pg.com').first<any>();
    expect(updated.meta).toEqual({ a: 9 });

    const hit = await new QueryBuilder('qk_extra').whereJsonContains('meta', { a: 9 }).all<any>();
    expect(hit).toHaveLength(1);
    expect(hit[0].email).toBe('a@pg.com');
  });

  it('rolls back a transaction', async () => {
    await exec.transaction(async (tx) => {
      await tx.executeQuery('INSERT INTO qk_users (email, active) VALUES ($1, $2)', ['tx@pg.com', 1]);
      throw new Error('nope');
    }).catch((e) => e);
    const rows = await exec.executeQuery('SELECT * FROM qk_users WHERE email = $1', ['tx@pg.com']);
    expect(rows.data.length).toBe(0);
  });
});
