import { describe, it, expect, beforeEach } from 'vitest';
import { QueryKitConfig, setDefaultExecutor } from '../config';
import { QueryBuilder } from '../query-builder';

class MockExec {
  queries: { sql: string; bindings: any[] }[] = [];
  executeQuerySync(sql: string, bindings: any[] = []) { this.queries.push({ sql, bindings }); return { data: [] }; }
  executeQuery(sql: string, bindings: any[] = []) { this.queries.push({ sql, bindings }); return Promise.resolve({ data: [] }); }
  runSync(sql: string, bindings: any[] = []) { this.queries.push({ sql, bindings }); return { changes: 1, lastInsertRowid: 1 }; }
}

describe('QueryBuilder', () => {
  let exec: MockExec;
  beforeEach(() => { exec = new MockExec(); setDefaultExecutor(exec as any); });

  it('builds simple select with where and order', () => {
    const qb = new QueryBuilder('users').select(['id','name']).where('role','=', 'admin').orderBy('id','DESC');
    const { sql, bindings } = qb.toSql();
    expect(sql).toMatch(/SELECT .* FROM users/);
    expect(sql).toMatch(/WHERE role = \?/);
    expect(bindings).toEqual(['admin']);
  });

  it('supports joins and group by having', () => {
    const qb = new QueryBuilder('orders as o')
      .innerJoinOn('users as u', 'u.id', 'o.user_id')
      .select(['u.id','COUNT(o.id) as total'])
      .groupBy(['u.id'])
      .having('total' as any, '>', 5);
    const { sql } = qb.toSql();
    expect(sql).toMatch(/INNER JOIN users as u ON u\.id = o\.user_id/);
    expect(sql).toMatch(/GROUP BY u\.id/);
    expect(sql).toMatch(/HAVING/);
  });

  it('paginates correctly', () => {
    const qb = new QueryBuilder('users').paginate(2, 10);
    const { sql, bindings } = qb.toSql();
    expect(sql).toMatch(/LIMIT \?/);
    expect(sql).toMatch(/OFFSET \?/);
    expect(bindings).toEqual([10, 10]);
  });

  it('like helpers build expected where', () => {
    const qb = new QueryBuilder('users').whereContains('name','john').whereStartsWithCI('email','test');
    const { sql } = qb.toSql();
    expect(sql).toMatch(/name LIKE \?/);
    expect(sql).toMatch(/email LIKE \? COLLATE NOCASE/);
  });

  it('union/unionAll composes queries', () => {
    const a = new QueryBuilder('a').select(['id']);
    const b = new QueryBuilder('b').select(['id']);
    a.unionAll(b);
    const { sql } = a.toSql();
    expect(sql).toMatch(/UNION ALL/);
  });

  it('executes via configured executor (allSync/getSync/run)', () => {
    const qb = new QueryBuilder('users').where('id','=',1);
    qb.allSync();
    qb.getSync();
    qb.run();
    expect(exec.queries.length).toBeGreaterThanOrEqual(2);
  });
}); 