import { describe, it, expect, beforeEach } from 'vitest';
import { setDefaultExecutor } from '../config';
import { QueryBuilder } from '../query-builder';

class Exec {
  executeQuerySync(sql: string, bindings: any[] = []) { return { data: [] }; }
  executeQuery(sql: string, bindings: any[] = []) { return Promise.resolve({ data: [] }); }
}

describe('QueryBuilder advanced helpers', () => {
  beforeEach(() => setDefaultExecutor(new Exec() as any));

  it('selectExpression and aggregates', () => {
    const qb = new QueryBuilder('logs').selectCount('*','cnt').selectSum('value');
    const { sql } = qb.toSql();
    expect(sql).toMatch(/COUNT\(\*\) AS cnt/);
    expect(sql).toMatch(/SUM\(value\) AS sum/);
  });

  it('period and range', () => {
    const qb = new QueryBuilder('events').period('created_at','24h').range('created_at', new Date(0), new Date(1));
    const { sql } = qb.toSql();
    expect(sql).toContain('created_at');
  });

  it('whereNotIn/Null/Between/Column', () => {
    const qb = new QueryBuilder('t')
      .whereNotIn('id',[1,2])
      .whereNull('deleted_at')
      .whereBetween('age',[18,30])
      .whereColumn('a','=','b');
    const { sql } = qb.toSql();
    expect(sql).toMatch(/id NOT IN \(/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/age BETWEEN \? AND \?/);
    expect(sql).toMatch(/a = b/);
  });

  it('exists subquery', () => {
    const sub = new QueryBuilder('child').where('parent_id','=',1);
    const qb = new QueryBuilder('parent').whereExists(sub);
    const { sql } = qb.toSql();
    expect(sql).toMatch(/EXISTS \(/);
  });

  it('orderByMany and groupByOne', () => {
    const qb = new QueryBuilder('items').groupByOne('type').orderByMany([{column:'a'},{column:'b',direction:'DESC'}]);
    const { sql } = qb.toSql();
    expect(sql).toMatch(/GROUP BY type/);
    expect(sql).toMatch(/ORDER BY a ASC, b DESC/);
  });
}); 