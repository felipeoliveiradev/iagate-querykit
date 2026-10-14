import { describe, it, expect, beforeEach } from 'vitest';
import { QueryBuilder } from '../query-builder.js';
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js';
import type { SqlDialect } from '../sql/dialect.js';

function exec(dialect: SqlDialect) {
  return {
    dialect,
    executeQuery: async () => ({ data: [] }),
    executeQuerySync: () => ({ data: [] }),
    runSync: () => ({ changes: 0, lastInsertRowid: 0 }),
  };
}

describe('dialect paging (D1)', () => {
  beforeEach(() => resetQueryKitConfig());

  it('emits LIMIT/OFFSET for sqlite/mysql/postgres', () => {
    for (const dialect of ['sqlite', 'mysql', 'postgres'] as const) {
      setDefaultExecutor(exec(dialect) as any);
      const { sql, bindings } = new QueryBuilder('users').paginate(2, 10).toSql();
      expect(sql).toMatch(/LIMIT \?/);
      expect(sql).toMatch(/OFFSET \?/);
      expect(bindings).toEqual([10, 10]);
    }
  });

  it('emits OFFSET FETCH for mssql and oracle', () => {
    for (const dialect of ['mssql', 'oracle'] as const) {
      setDefaultExecutor(exec(dialect) as any);
      const { sql, bindings } = new QueryBuilder('users').orderBy('id').paginate(2, 10).toSql();
      expect(sql).toMatch(/OFFSET \? ROWS FETCH NEXT \? ROWS ONLY/);
      expect(bindings).toEqual([10, 10]);
    }
  });

  it('adds a dummy ORDER BY on mssql when none is present', () => {
    setDefaultExecutor(exec('mssql') as any);
    const { sql } = new QueryBuilder('users').limit(5).toSql();
    expect(sql).toMatch(/ORDER BY \(SELECT NULL\)/);
    expect(sql).toMatch(/FETCH NEXT \? ROWS ONLY/);
  });

  it('emits a dummy LIMIT when sqlite/mysql offset has no limit', () => {
    setDefaultExecutor(exec('sqlite') as any);
    const sqlite = new QueryBuilder('users').offset(5).toSql();
    expect(sqlite.sql).toMatch(/LIMIT -1 OFFSET \?/);
    expect(sqlite.bindings).toEqual([5]);

    setDefaultExecutor(exec('mysql') as any);
    const mysql = new QueryBuilder('users').offset(5).toSql();
    expect(mysql.sql).toMatch(/LIMIT 18446744073709551615 OFFSET \?/);
    expect(mysql.bindings).toEqual([5]);

    setDefaultExecutor(exec('postgres') as any);
    const pg = new QueryBuilder('users').offset(5).toSql();
    expect(pg.sql).toMatch(/OFFSET \?/);
    expect(pg.sql).not.toMatch(/LIMIT/);
    expect(pg.bindings).toEqual([5]);
  });
});
