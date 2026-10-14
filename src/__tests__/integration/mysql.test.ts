import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { QueryBuilder } from '../../query-builder.js';
import { MysqlExecutor } from '../../adapters/mysql.js';

const host = process.env.MYSQL_HOST || '127.0.0.1';
const describeMysql = describe;

describeMysql('mysql integration', () => {
  let exec: MysqlExecutor;

  beforeAll(async () => {
    resetQueryKitConfig();
    exec = new MysqlExecutor({
      host,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });
    setDefaultExecutor(exec);
    await exec.executeQuery('DROP TABLE IF EXISTS qk_users', []);
    await exec.executeQuery(
      'CREATE TABLE qk_users (id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(255), active TINYINT)',
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

  it('returns QueryResult (not a tuple) and round-trips rows', async () => {
    const ins = await new QueryBuilder('qk_users').insert({ email: 'my@x.com', active: 1 }).make();
    expect(ins.changes).toBe(1);
    expect(Number(ins.lastInsertRowid)).toBeGreaterThan(0);

    const row = await new QueryBuilder('qk_users').where('email', '=', 'my@x.com').first<{ id: number }>();
    expect(row?.id).toBeTruthy();

    const direct = await exec.executeQuery('UPDATE qk_users SET active = ? WHERE id = ?', [0, row!.id]);
    expect(direct.data).toEqual([]);
    expect(direct.affectedRows).toBe(1);

    await new QueryBuilder('qk_users').where('id', '=', row!.id).delete().make();
  });

  it('handles reserved words, empty IN, null, pagination, rollback, concurrent reads', async () => {
    await exec.executeQuery('DROP TABLE IF EXISTS `order`', []);
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

  it('offset without limit and FIND_IN_SET', async () => {
    await exec.executeQuery('DROP TABLE IF EXISTS qk_extra', []);
    await exec.executeQuery(
      "CREATE TABLE qk_extra (id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(255), roles VARCHAR(255))",
      [],
    );
    await new QueryBuilder('qk_extra').insert({ email: 'a@my.com', roles: 'admin,user' }).make();
    await new QueryBuilder('qk_extra').insert({ email: 'b@my.com', roles: 'user' }).make();
    const skipped = await new QueryBuilder('qk_extra').orderBy('id').offset(1).all<any>();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].email).toBe('b@my.com');
    const admins = await new QueryBuilder('qk_extra').whereFindInSet('roles', 'admin').all<any>();
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('a@my.com');
  });
});
