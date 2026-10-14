import { describe, it, expect } from 'vitest';
import { compileSelect, compileWhere } from '../sql/compile.js';

describe('sql/compile', () => {
  it('compiles a select with where, order, and limit', () => {
    const { sql, bindings } = compileSelect(
      {
        tableName: 'users',
        selectColumns: ['id', 'email'],
        aggregates: [],
        isDistinct: false,
        joins: [],
        whereClauses: [{ type: 'basic', column: 'active', operator: '=', value: 1, logical: 'AND' }],
        orWhereClauses: [],
        groupByColumns: [],
        havingClauses: [],
        orderClauses: [{ column: 'id', direction: 'DESC' }],
        limitValue: 10,
        unionParts: [],
      },
      'sqlite',
    );
    expect(sql).toBe('SELECT "id", "email" FROM "users" WHERE "active" = ? ORDER BY "id" DESC LIMIT ?');
    expect(bindings).toEqual([1, 10]);
  });

  it('places selectBindings before where bindings', () => {
    const { bindings } = compileSelect(
      {
        tableName: 'users',
        selectColumns: ['id'],
        selectBindings: ['score'],
        aggregates: [],
        isDistinct: false,
        joins: [],
        whereClauses: [{ type: 'basic', column: 'email', operator: '=', value: 'a@x.com', logical: 'AND' }],
        orWhereClauses: [],
        groupByColumns: [],
        havingClauses: [],
        orderClauses: [],
        unionParts: [],
      },
      'sqlite',
    );
    expect(bindings).toEqual(['score', 'a@x.com']);
  });

  it('compileWhere binds IN lists and empty IN', () => {
    const params: unknown[] = [];
    const sql = compileWhere(
      [
        { type: 'in', column: 'id', value: [1, 2], logical: 'AND' },
        { type: 'in', column: 'role', value: [], logical: 'AND', not: false },
      ],
      'postgres',
      params,
      'AND',
    );
    expect(sql).toMatch(/"id" IN \(\?, \?\)/);
    expect(sql).toMatch(/1=0/);
    expect(params).toEqual([1, 2]);
  });
});
