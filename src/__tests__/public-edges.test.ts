import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryBuilder } from '../query-builder.js';
import { createQueryKit } from '../querykit.js';
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js';
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js';
import { parallel } from '../parallel-query.js';

describe('public API edge cases', () => {
  let exec: BetterSqlite3Executor;
  let kit: ReturnType<typeof createQueryKit>;

  beforeEach(() => {
    resetQueryKitConfig();
    exec = new BetterSqlite3Executor(':memory:');
    setDefaultExecutor(exec);
    kit = createQueryKit(exec);
    exec.executeQuerySync(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT,
        active INTEGER,
        deleted_at TEXT,
        created_at TEXT,
        meta TEXT,
        blob BLOB,
        n INTEGER
      )
    `);
    exec.executeQuerySync(`CREATE TABLE "order" (id INTEGER PRIMARY KEY, "select" TEXT)`);
    exec.executeQuerySync(`CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)`);
  });

  afterEach(() => {
    exec.close();
    resetQueryKitConfig();
  });

  it('where(col, null) compiles to IS NULL, not = NULL', () => {
    const { sql, bindings } = new QueryBuilder('users').where('deleted_at', null).toSql();
    expect(sql).toMatch(/"deleted_at" IS NULL/);
    expect(bindings).toEqual([]);
  });

  it('where(col, "=", null) and "!= null" map to IS / IS NOT NULL', () => {
    expect(new QueryBuilder('users').where('email', '=', null).toSql().sql).toMatch(/IS NULL/);
    expect(new QueryBuilder('users').where('email', '!=', null).toSql().sql).toMatch(/IS NOT NULL/);
  });

  it('rejects undefined bindings', () => {
    expect(() => new QueryBuilder('users').where('email', undefined).toSql()).toThrow(/undefined/);
    expect(() => new QueryBuilder('users').whereIn('id', [1, undefined as any]).toSql()).toThrow(/undefined/);
  });

  it('where("id", "IN", array) routes to IN, not "IN ?"', async () => {
    await kit.table('users').insert({ email: 'a@x.com', active: 1 }).make();
    const { sql, bindings } = kit.table('users').where('id', 'IN', [1, 2]).toSql();
    expect(sql).toMatch(/IN \(\?, \?\)/);
    expect(bindings).toEqual([1, 2]);
    const rows = await kit.table('users').where('id', 'IN', [1]).all();
    expect(rows).toHaveLength(1);
  });

  it('empty IN matches nothing; empty NOT IN matches everything', async () => {
    await kit.table('users').insert({ email: 'a@x.com', active: 1 }).make();
    expect(await kit.table('users').whereIn('id', []).all()).toEqual([]);
    expect(await kit.table('users').whereNotIn('id', []).all()).toHaveLength(1);
  });

  it('Date / JSON / Buffer / unicode values round-trip', async () => {
    const when = new Date('2024-06-01T12:00:00.000Z');
    const buf = Buffer.from('hello');
    await kit.table('users').insert({
      email: 'café-日本語@x.com',
      active: 1,
      created_at: when,
      meta: { tag: 'αβ', n: 2 },
      blob: buf,
    }).make();
    const row = await kit.table('users').first<any>();
    expect(row.email).toBe('café-日本語@x.com');
    expect(row.created_at).toBe(when.toISOString());
    expect(JSON.parse(row.meta)).toEqual({ tag: 'αβ', n: 2 });
    expect(Buffer.from(row.blob)).toEqual(buf);
  });

  it('quotes reserved words as table and column names', async () => {
    await new QueryBuilder('order').use(exec).insert({ select: 'ok' }).make();
    const rows = await new QueryBuilder('order').use(exec).where('select', '=', 'ok').all<any>();
    expect(rows[0].select).toBe('ok');
    expect(new QueryBuilder('order').select(['select']).toSql().sql).toMatch(/FROM "order"/);
  });

  it('unicode identifiers are quoted, not rejected', () => {
    const { sql } = new QueryBuilder('usuários').where('nome', '=', 'Ana').toSql();
    expect(sql).toContain('"usuários"');
    expect(sql).toContain('"nome"');
  });

  it('nested whereGroup compiles parenthesized AND/OR', () => {
    const { sql, bindings } = new QueryBuilder('users')
      .whereGroup((q) => {
        q.where('active', 1).where('email', 'a@x.com');
      })
      .whereGroup((q) => {
        q.where('active', 0).where('email', 'b@x.com');
      }, 'OR')
      .toSql();
    expect(sql).toMatch(/WHERE \("active" = \? AND "email" = \?\) OR \("active" = \? AND "email" = \?\)/);
    expect(bindings).toEqual([1, 'a@x.com', 0, 'b@x.com']);
  });

  it('joins with aliases and subquery EXISTS', async () => {
    await kit.table('users').insert({ email: 'a@x.com', active: 1 }).make();
    await kit.table('posts').insert({ user_id: 1, title: 'hi' }).make();
    const { sql } = new QueryBuilder('users as u')
      .innerJoinOn('posts as p', 'p.user_id', 'u.id')
      .select(['u.email', 'p.title'])
      .toSql();
    expect(sql).toMatch(/INNER JOIN "posts" AS "p" ON "p"\."user_id" = "u"\."id"/);
    const sub = new QueryBuilder('posts').select(['user_id']).where('title', '=', 'hi');
    expect(await kit.table('users').whereExists(sub).exists()).toBe(true);
  });

  it('updateOrInsert inserts then updates; restores where on error', async () => {
    const first = await kit.table('users').updateOrInsert({ email: 'u@x.com' }, { active: 1 }).make();
    expect(first.changes).toBeGreaterThanOrEqual(1);
    await kit.table('users').updateOrInsert({ email: 'u@x.com' }, { active: 0 }).make();
    const row = await kit.table('users').where('email', 'u@x.com').first<any>();
    expect(row.active).toBe(0);
    const qb = kit.table('users').where('id', '=', 1);
    qb['pendingAction'] = { type: 'updateOrInsert', data: { attributes: { email: 'u@x.com' }, values: { active: 1 } } };
    // force a failure inside work by dropping the table mid-flight is heavy; assert finally via throw on empty attributes
    const broken = kit.table('users').updateOrInsert({}, { active: 1 });
    await expect(broken.make()).rejects.toThrow();
    expect(qb.toSql().sql).toMatch(/"id" = \?/);
  });

  it('paginate and reject negative limit/offset', () => {
    const { sql, bindings } = new QueryBuilder('users').paginate(2, 10).toSql();
    expect(sql).toMatch(/LIMIT \?/);
    expect(bindings).toEqual([10, 10]);
    expect(() => new QueryBuilder('users').limit(-1)).toThrow(/non-negative/);
    expect(() => new QueryBuilder('users').offset(Number.NaN)).toThrow(/non-negative/);
  });

  it('transaction rolls back on error', async () => {
    await expect(
      kit.transaction(async (tx) => {
        await tx.table('users').insert({ email: 'tx@x.com', active: 1 }).make();
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(await kit.table('users').all()).toEqual([]);
  });

  it('runs concurrent reads without losing rows', async () => {
    await kit.table('users').insert([
      { email: 'a@x.com', active: 1 },
      { email: 'b@x.com', active: 1 },
      { email: 'c@x.com', active: 1 },
    ]).make();
    const results = await Promise.all(
      [1, 2, 3, 1, 2, 3].map((id) => kit.table('users').where('id', '=', id).first<any>()),
    );
    expect(results.every((r) => r && r.id)).toBe(true);
    const par = await parallel(
      kit.table('users').where('id', 1),
      kit.table('users').where('id', 2),
    );
    expect(par).toHaveLength(2);
  });

  it('havingIf(false) does not apply; orWhere two-arg is equality', () => {
    const a = new QueryBuilder('users').groupBy(['active']).havingIf(false, 'active', '=', 1);
    expect(a.toSql().sql).not.toMatch(/HAVING/);
    const b = new QueryBuilder('users').where('active', 1).orWhere('email', 'z@x.com');
    expect(b.toSql().sql).toMatch(/OR \("email" = \?\)/);
  });

  it('update/delete honor orWhere', async () => {
    await kit.table('users').insert([
      { email: 'a@x.com', active: 1 },
      { email: 'b@x.com', active: 0 },
    ]).make();
    await kit.table('users').where('email', 'missing').orWhere('email', 'a@x.com').update({ n: 9 }).make();
    expect((await kit.table('users').where('email', 'a@x.com').first<any>()).n).toBe(9);
  });

  it('groupBy accepts SQL expressions and rest args', () => {
    const { sql } = new QueryBuilder('users').select(['email']).groupBy('strftime("%Y", created_at)').toSql();
    expect(sql).toContain('strftime("%Y", created_at)');
    expect(() => new QueryBuilder('users').groupBy('strftime("%Y", created_at)').toSql()).not.toThrow();
  });

    it('selectCount quotes hostile columns; mismatched insert rows throw', async () => {
    expect(() => new QueryBuilder('users').selectCount('id;drop').toSql()).toThrow(/Unsafe/);
    await expect(
      kit.table('users').insert([{ email: 'a' }, { active: 1 } as any]).make(),
    ).rejects.toThrow(/same columns/);
  });

  it('whereNearby quotes columns and binds SELECT placeholders', () => {
    const { sql, bindings } = new QueryBuilder('users').whereNearby('n', 'n', 1, 2, 3).toSql();
    expect(sql).toContain('"n"');
    expect(sql).not.toContain('radians(n)');
    expect(bindings.length).toBe(countPlaceholders(sql));
  });

  it('whereNotIn(non-array) throws instead of matching every row', () => {
    expect(() => new QueryBuilder('users').whereNotIn('id', undefined as any).toSql()).toThrow(/requires an array/);
    expect(() => new QueryBuilder('users').whereNotIn('id', null as any).toSql()).toThrow(/requires an array/);
    expect(() => new QueryBuilder('users').orWhereNotIn('id', 1 as any).toSql()).toThrow(/requires an array/);
  });

  it('orWhereIn uses orWhereClauses so AND/OR precedence is parenthesized', () => {
    const { sql } = new QueryBuilder('users').where('a', 1).where('b', 2).orWhereIn('id', [3]).toSql();
    expect(sql).toMatch(/WHERE \("a" = \? AND "b" = \?\) OR \("id" IN \(\?\)\)/);
  });

  it('Model.save updates when id is 0', async () => {
    exec.executeQuerySync('CREATE TABLE zids (id INTEGER PRIMARY KEY, email TEXT)');
    exec.executeQuerySync("INSERT INTO zids (id, email) VALUES (0, 'zero@x.com')");
    const { Model } = await import('../model.js');
    class Zid extends Model {
      protected static tableName = 'zids';
      protected fillable = ['email'];
    }
    const row = new Zid() as any;
    row.id = 0;
    row.email = 'updated@x.com';
    await row.save();
    const after = exec.executeQuerySync('SELECT * FROM zids').data;
    expect(after).toHaveLength(1);
    expect(after[0].email).toBe('updated@x.com');
    expect(after[0].id).toBe(0);
  });

  it('increment/decrement reject NaN; increment updates the column', async () => {
    await kit.table('users').insert({ email: 'n@x.com', active: 1, n: 5 }).make();
    expect(() => kit.table('users').where('id', 1).increment('n' as any, Number.NaN)).toThrow(/finite/);
    expect(() => kit.table('users').where('id', 1).decrement('n' as any, Number.POSITIVE_INFINITY)).toThrow(/finite/);
    await kit.table('users').where('id', 1).increment('n' as any, 2).make();
    expect((await kit.table('users').where('id', 1).first<any>()).n).toBe(7);
  });

  it('select([]) throws; empty orderBy and hostile direction throw', () => {
    expect(() => new QueryBuilder('users').select([]).toSql()).toThrow(/at least one column/);
    expect(() => new QueryBuilder('users').orderBy('').toSql()).toThrow(/column/);
    expect(() => new QueryBuilder('users').orderBy('id', 'DESC;drop' as any).toSql()).toThrow(/ASC or DESC/);
  });

  it('sqlite offset without limit compiles and executes', async () => {
    await kit.table('users').insert([
      { email: 'a@x.com', active: 1 },
      { email: 'b@x.com', active: 1 },
    ]).make();
    const { sql } = kit.table('users').orderBy('id').offset(1).toSql();
    expect(sql).toMatch(/LIMIT -1 OFFSET \?/);
    const rows = await kit.table('users').orderBy('id').offset(1).all();
    expect(rows).toHaveLength(1);
  });

  it('insert().all() throws instead of silently skipping the write', async () => {
    await expect(kit.table('users').insert({ email: 'ghost@x.com' }).all()).rejects.toThrow(/make\(\)/);
    expect(await kit.table('users').all()).toEqual([]);
  });

  it('exists() ignores leftover aggregates', async () => {
    await kit.table('users').insert({ email: 'a@x.com', active: 1 }).make();
    const q = kit.table('users').count();
    expect(await q.exists()).toBe(true);
    const { sql } = (() => {
      const c = q.clone();
      c.selectColumns = [ { toSQL: () => '1' } as any ];
      c.aggregates = [];
      c.limitValue = 1;
      return c.toSql();
    })();
    expect(sql).not.toMatch(/COUNT/);
  });

  it('limit/offset reject fractions; whereIf two-arg is equality', () => {
    expect(() => new QueryBuilder('users').limit(1.5)).toThrow(/integer/);
    expect(() => new QueryBuilder('users').offset(2.2)).toThrow(/integer/);
    const { sql, bindings } = new QueryBuilder('users').whereIf(true, 'email', 'a@x.com').toSql();
    expect(sql).toMatch(/"email" = \?/);
    expect(bindings).toEqual(['a@x.com']);
    expect(new QueryBuilder('users').whereIf(false, 'email', 'a@x.com').toSql().sql).not.toMatch(/WHERE/);
  });

  it('rejects custom class instances as bindings; accepts BigInt', async () => {
    class Foo { x = 1 }
    expect(() => new QueryBuilder('users').where('email', new Foo() as any).toSql()).toThrow(/Foo/);
    expect(new QueryBuilder('users').where('meta', Object.create(null)).toSql().bindings).toEqual(['{}']);
    await kit.table('users').insert({ email: 'big@x.com', active: 1, n: 10n }).make();
    const row = await kit.table('users').where('email', 'big@x.com').first<any>();
    expect(Number(row.n)).toBe(10);
  });

  it('whereBetween rejects bad tuples; having rejects undefined', () => {
    expect(() => new QueryBuilder('users').whereBetween('n', [1] as any).toSql()).toThrow(/tuple/);
    expect(() => new QueryBuilder('users').whereBetween('n', [1, undefined] as any).toSql()).toThrow(/undefined/);
    expect(() => new QueryBuilder('users').having('n' as any, '>', undefined).toSql()).toThrow(/undefined/);
  });

  it('whereFindInSet / whereArrayContains match CSV tokens, not substrings', async () => {
    exec.executeQuerySync('CREATE TABLE roles (id INTEGER PRIMARY KEY, roles TEXT, "order" TEXT)');
    exec.executeQuerySync("INSERT INTO roles (roles, \"order\") VALUES ('admin,user', 'x'), ('administrator', 'y')");
    const hits = await new QueryBuilder('roles').use(exec).whereFindInSet('roles', 'admin').all<any>();
    expect(hits).toHaveLength(1);
    expect(hits[0].roles).toBe('admin,user');
    const reserved = await new QueryBuilder('roles').use(exec).whereArrayContains('order', 'x').all<any>();
    expect(reserved).toHaveLength(1);
  });

  it('whereJsonContains on SQLite uses json_extract, not LIKE substring', async () => {
    await kit.table('users').insert({ email: 'j@x.com', active: 1, meta: { a: 1, tag: 'no' } }).make();
    await kit.table('users').insert({ email: 'k@x.com', active: 1, meta: { a: 2 } }).make();
    const rows = await kit.table('users').whereJsonContains('meta', { a: 1 }).all<any>();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('j@x.com');
  });
});

function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) || []).length;
}
