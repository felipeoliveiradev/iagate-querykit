import { describe, it, expect, beforeEach } from 'vitest';
import { QueryBuilder } from '../query-builder.js';
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js';
import { UnsafeIdentifierError } from '../sql/identifiers.js';

class MockExec {
  dialect = 'sqlite' as const;
  queries: { sql: string; bindings: any[] }[] = [];
  executeQuerySync(sql: string, bindings: any[] = []) {
    this.queries.push({ sql, bindings });
    return { data: [{ id: 1 }] };
  }
  executeQuery(sql: string, bindings: any[] = []) {
    this.queries.push({ sql, bindings });
    return Promise.resolve({ data: [{ id: 1 }] });
  }
  runSync(sql: string, bindings: any[] = []) {
    this.queries.push({ sql, bindings });
    return { changes: 2, lastInsertRowid: 7 };
  }
}

describe('SQL security', () => {
  let exec: MockExec;
  beforeEach(() => {
    resetQueryKitConfig();
    exec = new MockExec();
    setDefaultExecutor(exec as any);
  });

  it('rejects hostile table identifiers (S1)', () => {
    expect(() => new QueryBuilder('users;drop table users--').toSql()).toThrow(UnsafeIdentifierError);
  });

  it('rejects hostile column identifiers (S1)', () => {
    expect(() => new QueryBuilder('users').where('id = 1; drop table users--' as any, '=', 1).toSql()).toThrow(
      UnsafeIdentifierError,
    );
  });

  it('quotes safe identifiers', () => {
    const { sql, bindings } = new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1).toSql();
    expect(sql).toBe('SELECT "id", "email" FROM "users" WHERE "active" = ?');
    expect(bindings).toEqual([1]);
  });

  it('binds havingRaw parameters (S3)', () => {
    const { sql, bindings } = new QueryBuilder('users')
      .groupBy(['role'])
      .havingRaw('COUNT(*) > ?', [3])
      .toSql();
    expect(sql).toMatch(/HAVING COUNT\(\*\) > \?/);
    expect(bindings).toEqual([3]);
  });

  it('binds whereJsonContains (S4) with sqlite concatenation', () => {
    const { sql, bindings } = new QueryBuilder('users').whereJsonContains('meta', { a: 1 }).toSql();
    expect(sql).toMatch(/"meta" LIKE '%' \|\| \? \|\| '%'/);
    expect(bindings).toEqual([JSON.stringify({ a: 1 })]);
  });

  it('where(column, value) is equality', () => {
    const { sql, bindings } = new QueryBuilder('users').where('active', true).toSql();
    expect(sql).toMatch(/WHERE "active" = \?/);
    expect(bindings).toEqual([true]);
  });
});
