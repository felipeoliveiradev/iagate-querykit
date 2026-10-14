import { describe, it, expect, beforeEach } from 'vitest';
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js';
import { isSelectLike } from '../sql/dialect.js';

describe('select detection (C4)', () => {
  it('recognizes CTE, comments, pragma, explain', () => {
    expect(isSelectLike('SELECT 1')).toBe(true);
    expect(isSelectLike('  /*x*/ SELECT 1')).toBe(true);
    expect(isSelectLike('-- hi\nSELECT 1')).toBe(true);
    expect(isSelectLike('WITH t AS (SELECT 1) SELECT * FROM t')).toBe(true);
    expect(isSelectLike('PRAGMA foreign_keys')).toBe(true);
    expect(isSelectLike('EXPLAIN QUERY PLAN SELECT 1')).toBe(true);
    expect(isSelectLike('INSERT INTO t VALUES (1)')).toBe(false);
  });
});

describe('BetterSqlite3Executor lifecycle', () => {
  beforeEach(() => {
    delete (globalThis as any).__vitest_mocks__;
  });

  it('sets dialect, closes, and wraps an existing db when available', async () => {
    let BetterSqlite3: any;
    try {
      const req = await import('better-sqlite3');
      BetterSqlite3 = req.default;
    } catch {
      return;
    }
    const db = new BetterSqlite3(':memory:');
    const exec = new BetterSqlite3Executor(db);
    expect(exec.dialect).toBe('sqlite');
    const fk = exec.executeQuerySync('PRAGMA foreign_keys');
    expect(fk.data[0].foreign_keys).toBe(1);
    exec.close();
    db.close();
  });
});
