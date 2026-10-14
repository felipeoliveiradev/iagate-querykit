import { describe, it, expect } from 'vitest';
import { toPostgresParams, toOracleParams, toMssqlParams, countPlaceholders } from '../sql/placeholders.js';
import { inlineBindings } from '../sql/literals.js';

describe('placeholder conversion (S2)', () => {
  it('converts only unbound question marks', () => {
    const sql = `SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?`;
    expect(toPostgresParams(sql)).toBe(`SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2`);
    expect(toOracleParams(sql)).toBe(`SELECT * FROM t WHERE a = :1 AND b = '?' AND c = :2`);
    const mssql = toMssqlParams(sql);
    expect(mssql.sql).toBe(`SELECT * FROM t WHERE a = @p1 AND b = '?' AND c = @p2`);
    expect(mssql.paramNames).toEqual(['p1', 'p2']);
  });

  it('does not rewrite ? inside comments', () => {
    const sql = `SELECT ? -- keep ? here\nFROM t /* and ? here */`;
    expect(toPostgresParams(sql)).toBe(`SELECT $1 -- keep ? here\nFROM t /* and ? here */`);
  });

  it('does not rewrite postgres JSON ? operators when they sit in literals', () => {
    const sql = `SELECT '{"a":1}'::jsonb ? 'a' FROM t WHERE id = ?`;
    expect(toPostgresParams(sql)).toBe(`SELECT '{"a":1}'::jsonb ? 'a' FROM t WHERE id = $1`);
  });

  it('inlines bindings without touching quoted question marks (S5)', () => {
    const sql = `SELECT * FROM t WHERE note = '?' AND id = ?`;
    expect(inlineBindings(sql, [9])).toBe(`SELECT * FROM t WHERE note = '?' AND id = 9`);
  });

  it('counts placeholders outside literals', () => {
    expect(countPlaceholders(`a = ? AND b = '?'`)).toBe(1);
  });
});
