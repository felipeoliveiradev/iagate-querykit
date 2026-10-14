import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { QueryBuilder } from '../../query-builder.js';
import { PostgresExecutor } from '../../adapters/postgresql.js';

const host = process.env.POSTGRES_HOST;
const describePg = host ? describe : describe.skip;

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

  it('rolls back a transaction', async () => {
    await exec.transaction(async (tx) => {
      await tx.executeQuery('INSERT INTO qk_users (email, active) VALUES ($1, $2)', ['tx@pg.com', 1]);
      throw new Error('nope');
    }).catch((e) => e);
    const rows = await exec.executeQuery('SELECT * FROM qk_users WHERE email = $1', ['tx@pg.com']);
    expect(rows.data.length).toBe(0);
  });
});
