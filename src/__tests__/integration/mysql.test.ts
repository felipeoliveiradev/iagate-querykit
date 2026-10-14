import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { QueryBuilder } from '../../query-builder.js';
import { openEphemeralMysql, type EphemeralHandle } from './ephemeral.js';
import type { MysqlExecutor } from '../../adapters/mysql.js';

describe('mysql integration (throwaway loopback only)', () => {
  let handle: EphemeralHandle<MysqlExecutor>;
  let exec: MysqlExecutor;

  beforeAll(async () => {
    resetQueryKitConfig();
    handle = await openEphemeralMysql();
    exec = handle.exec;
    setDefaultExecutor(exec);
    await exec.executeQuery(
      'CREATE TABLE qk_users (id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(255), active TINYINT)',
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

  it('returns QueryResult (not a tuple) and round-trips rows', async () => {
    const ins = await new QueryBuilder('qk_users').insert({ email: 'my@example.test', active: 1 }).make();
    expect(ins.changes).toBe(1);
    expect(Number(ins.lastInsertRowid)).toBeGreaterThan(0);

    const row = await new QueryBuilder('qk_users').where('email', '=', 'my@example.test').first<{ id: number }>();
    expect(row?.id).toBeTruthy();

    const direct = await exec.executeQuery('UPDATE qk_users SET active = ? WHERE id = ?', [0, row!.id]);
    expect(direct.data).toEqual([]);
    expect(direct.affectedRows).toBe(1);

    await new QueryBuilder('qk_users').where('id', '=', row!.id).delete().make();
  });

  it('handles reserved words, empty IN, null, pagination, rollback, concurrent reads', async () => {
    await exec.executeQuery(
      'CREATE TABLE `order` (id INT PRIMARY KEY AUTO_INCREMENT, `select` VARCHAR(64), deleted_at DATETIME NULL)',
      [],
    );
    await new QueryBuilder('order').insert({ select: 'ok' }).make();
    const row = await new QueryBuilder('order').where('select', '=', 'ok').first<any>();
    expect(row.select).toBe('ok');
    expect(await new QueryBuilder('order').whereIn('id', []).all()).toEqual([]);
    expect(await new QueryBuilder('order').where('deleted_at', null).all()).toHaveLength(1);
    const page = await new QueryBuilder('order').orderBy('id').paginate(1, 5).all();
    expect(page).toHaveLength(1);

    await expect(
      exec.transaction(async (tx) => {
        await tx.executeQuery('INSERT INTO `order` (`select`) VALUES (?)', ['tx']);
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    const after = await exec.executeQuery('SELECT COUNT(*) AS c FROM `order` WHERE `select` = ?', ['tx']);
    expect(Number(after.data[0].c)).toBe(0);

    const concurrent = await Promise.all([
      new QueryBuilder('order').where('id', '=', row.id).first(),
      new QueryBuilder('order').where('id', '=', row.id).first(),
    ]);
    expect(concurrent[0]?.id).toBe(row.id);
  });

  it('full-text and nearby helpers run on throwaway MySQL', async () => {
    await exec.executeQuery(
      `CREATE TABLE qk_places (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255),
        body TEXT,
        lat DOUBLE,
        lng DOUBLE,
        FULLTEXT KEY ft_places (name, body)
      )`,
      [],
    );
    await new QueryBuilder('qk_places').insert([
      { name: 'Sao Paulo', body: 'coffee shop downtown', lat: -23.5505, lng: -46.6333 },
      { name: 'Osasco', body: 'warehouse', lat: -23.5329, lng: -46.7916 },
      { name: 'Lisbon', body: 'pastelaria', lat: 38.7223, lng: -9.1393 },
    ]).make();

    const fts = await new QueryBuilder('qk_places').whereFullText(['name', 'body'], 'coffee').all<any>();
    expect(fts.some((r) => r.name === 'Sao Paulo')).toBe(true);

    const near = await new QueryBuilder('qk_places')
      .whereNearby('lat', 'lng', -23.5505, -46.6333, 20)
      .all<any>();
    const names = near.map((r) => r.name);
    expect(names).toContain('Sao Paulo');
    expect(names).toContain('Osasco');
    expect(names).not.toContain('Lisbon');

    const rx = await new QueryBuilder('qk_places').whereRegex('name', 'Sao', 'i').all<any>();
    expect(rx.some((r) => /Sao/.test(r.name))).toBe(true);
  });

  it('offset without limit and FIND_IN_SET', async () => {
    await exec.executeQuery(
      'CREATE TABLE qk_extra (id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(255), roles VARCHAR(255))',
      [],
    );
    await new QueryBuilder('qk_extra').insert({ email: 'a@example.test', roles: 'admin,user' }).make();
    await new QueryBuilder('qk_extra').insert({ email: 'b@example.test', roles: 'user' }).make();
    const skipped = await new QueryBuilder('qk_extra').orderBy('id').offset(1).all<any>();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].email).toBe('b@example.test');
    const admins = await new QueryBuilder('qk_extra').whereFindInSet('roles', 'admin').all<any>();
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('a@example.test');
  });
});
