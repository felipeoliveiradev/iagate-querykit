import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { QueryBuilder } from '../../query-builder.js';
import { MysqlExecutor } from '../../adapters/mysql.js';

const host = process.env.MYSQL_HOST;
const describeMysql = host ? describe : describe.skip;

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
});
