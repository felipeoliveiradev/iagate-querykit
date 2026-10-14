import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { QueryBuilder } from '../../query-builder.js';
import { openEphemeralPostgres, type EphemeralHandle } from './ephemeral.js';
import type { PostgresExecutor } from '../../adapters/postgresql.js';

describe('postgres integration (throwaway loopback only)', () => {
  let handle: EphemeralHandle<PostgresExecutor>;
  let exec: PostgresExecutor;

  beforeAll(async () => {
    resetQueryKitConfig();
    handle = await openEphemeralPostgres();
    exec = handle.exec;
    setDefaultExecutor(exec);
    await exec.executeQuery(
      'CREATE TABLE qk_users (id SERIAL PRIMARY KEY, email TEXT, active INT)',
      [],
    );
  });

  afterAll(async () => {
    try {
      await handle?.destroy();
    } finally {
      resetQueryKitConfig();
    }
  });

  it('inserts, selects, updates, deletes with $n conversion', async () => {
    const ins = await new QueryBuilder('qk_users').insert({ email: 'pg@example.test', active: 1 }).make();
    expect(ins.changes).toBeGreaterThanOrEqual(1);

    const row = await new QueryBuilder('qk_users').where('email', '=', 'pg@example.test').first<{ id: number; email: string }>();
    expect(row?.email).toBe('pg@example.test');
    expect(row?.id).toBeTruthy();

    await new QueryBuilder('qk_users').where('id', '=', row!.id).update({ active: 0 }).make();
    const updated = await new QueryBuilder('qk_users').where('id', '=', row!.id).first<{ active: number }>();
    expect(Number(updated?.active)).toBe(0);

    await new QueryBuilder('qk_users').where('id', '=', row!.id).delete().make();
    expect(await new QueryBuilder('qk_users').where('id', '=', row!.id).exists()).toBe(false);
  });

  it('handles reserved words, empty IN, null, JSON, pagination, concurrent reads', async () => {
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
    await exec.executeQuery(
      'CREATE TABLE qk_extra (id SERIAL PRIMARY KEY, email TEXT UNIQUE, meta JSONB)',
      [],
    );
    await new QueryBuilder('qk_extra').insert({ email: 'a@example.test', meta: { a: 1 } }).make();
    await new QueryBuilder('qk_extra').insert({ email: 'b@example.test', meta: { a: 2 } }).make();
    const skipped = await new QueryBuilder('qk_extra').orderBy('id').offset(1).all<any>();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].email).toBe('b@example.test');

    await new QueryBuilder('qk_extra').updateOrInsert({ email: 'a@example.test' }, { meta: { a: 9 } }).make();
    const updated = await new QueryBuilder('qk_extra').where('email', '=', 'a@example.test').first<any>();
    expect(updated.meta).toEqual({ a: 9 });

    const hit = await new QueryBuilder('qk_extra').whereJsonContains('meta', { a: 9 }).all<any>();
    expect(hit).toHaveLength(1);
    expect(hit[0].email).toBe('a@example.test');
  });

  it('full-text and nearby helpers run on throwaway Postgres', async () => {
    await exec.executeQuery(
      `CREATE TABLE qk_places (
        id SERIAL PRIMARY KEY,
        name TEXT,
        body TEXT,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION
      )`,
      [],
    );
    await new QueryBuilder('qk_places').insert([
      { name: 'Sao Paulo', body: 'coffee shop downtown', lat: -23.5505, lng: -46.6333 },
      { name: 'Osasco', body: 'warehouse', lat: -23.5329, lng: -46.7916 },
      { name: 'Lisbon', body: 'pastelaria', lat: 38.7223, lng: -9.1393 },
    ]).make();

    const fts = await new QueryBuilder('qk_places').whereFullText(['name', 'body'], 'coffee', 'english').all<any>();
    expect(fts.some((r) => r.name === 'Sao Paulo')).toBe(true);

    const near = await new QueryBuilder('qk_places')
      .whereNearby('lat', 'lng', -23.5505, -46.6333, 20)
      .all<any>();
    const names = near.map((r) => r.name);
    expect(names).toContain('Sao Paulo');
    expect(names).toContain('Osasco');
    expect(names).not.toContain('Lisbon');

    const rx = await new QueryBuilder('qk_places').whereRegex('name', 'sao', 'i').all<any>();
    expect(rx.some((r) => /sao/i.test(r.name))).toBe(true);
  });

  it('rolls back a transaction', async () => {
    await exec.transaction(async (tx) => {
      await tx.executeQuery('INSERT INTO qk_users (email, active) VALUES ($1, $2)', ['tx@example.test', 1]);
      throw new Error('nope');
    }).catch((e) => e);
    const rows = await exec.executeQuery('SELECT * FROM qk_users WHERE email = $1', ['tx@example.test']);
    expect(rows.data.length).toBe(0);
  });
});
