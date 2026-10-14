import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { QueryBuilder } from '../query-builder.js';
import { quoteIdent, isSafeIdent, UnsafeIdentifierError } from '../sql/identifiers.js';
import { countPlaceholders } from '../sql/placeholders.js';
import { compileSelect } from '../sql/compile.js';

const identArb = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/);
const unsafeArb = fc.constantFrom(
  "users;drop table users--",
  "id`",
  'x"y',
  "1id",
  "",
  "foo-bar",
  "a;b",
);

describe('property / fuzz tests for the SQL compiler', () => {
  it('safe identifiers always quote and never throw', () => {
    fc.assert(
      fc.property(identArb, (name) => {
        const q = quoteIdent(name, 'sqlite');
        expect(q.startsWith('"') && q.endsWith('"')).toBe(true);
        expect(q).not.toContain(';');
        const { sql } = new QueryBuilder(name).where(name, '=', 1).toSql();
        expect(sql).toContain(q);
        expect(countPlaceholders(sql)).toBe(1);
      }),
      { numRuns: 80 },
    );
  });

  it('unsafe identifiers always throw UnsafeIdentifierError', () => {
    fc.assert(
      fc.property(unsafeArb, (name) => {
        expect(isSafeIdent(name)).toBe(false);
        expect(() => new QueryBuilder(name).toSql()).toThrow(UnsafeIdentifierError);
      }),
      { numRuns: 40 },
    );
  });

  it('every emitted ? has a matching binding (and vice versa)', () => {
    fc.assert(
      fc.property(
        identArb,
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 0, maxLength: 8 }),
        fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
        (table, ids, email) => {
          const qb = new QueryBuilder(table).select(['id']);
          if (ids.length) qb.whereIn('id', ids);
          if (email !== undefined) qb.where('email', '=', email);
          const { sql, bindings } = qb.toSql();
          expect(countPlaceholders(sql)).toBe(bindings.length);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('empty IN is unsatisfiable and binds nothing', () => {
    const { sql, bindings } = new QueryBuilder('users').whereIn('id', []).toSql();
    expect(sql).toMatch(/1=0/);
    expect(bindings).toEqual([]);
  });

  it('clone is independent of later mutation', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        const qb = new QueryBuilder('t').where('id', '=', a);
        const c = qb.clone();
        qb.where('n', '=', b);
        expect(c.toSql().bindings).toEqual([a]);
        expect(qb.toSql().bindings).toEqual([a, b]);
      }),
      { numRuns: 40 },
    );
  });

  it('toSql is deterministic', () => {
    const qb = new QueryBuilder('users').where('id', 'IN', [1, 2, 3]).orderBy('id').limit(5);
    expect(qb.toSql()).toEqual(qb.toSql());
  });

  it('whereNotIn(non-array) never compiles to 1=1', () => {
    fc.assert(
      fc.property(fc.constantFrom(undefined, null, 1, 'x', { a: 1 }), (bad) => {
        expect(() => new QueryBuilder('users').whereNotIn('id', bad as any).toSql()).toThrow(/requires an array|undefined/);
      }),
      { numRuns: 20 },
    );
  });

  it('orWhereIn is parenthesized like orWhere', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 5 }), (ids) => {
        const { sql } = new QueryBuilder('users').where('a', 1).where('b', 2).orWhereIn('id', ids).toSql();
        expect(sql).toMatch(/WHERE \("a" = \? AND "b" = \?\) OR \("id" IN/);
        expect(sql).not.toMatch(/AND "b" = \? OR "id" IN/);
      }),
      { numRuns: 20 },
    );
  });

  it('orderBy rejects non ASC/DESC directions', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/^(asc|desc)$/i.test(s)), (dir) => {
        expect(() => new QueryBuilder('users').orderBy('id', dir as any).toSql()).toThrow(/ASC or DESC/);
      }),
      { numRuns: 40 },
    );
  });

  it('Date / JSON bindings stay in the params array', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.dictionary(identArb, fc.integer(), { maxKeys: 3 }), (ms, obj) => {
        const when = new Date(ms);
        const { sql, bindings } = new QueryBuilder('users').where('created_at', when).where('meta', obj).toSql();
        expect(countPlaceholders(sql)).toBe(bindings.length);
        expect(bindings[0]).toBe(when.toISOString());
        expect(bindings[1]).toBe(JSON.stringify(obj));
        expect(sql).not.toContain(when.toISOString());
      }),
      { numRuns: 30 },
    );
  });

  it('compileSelect never interpolates a raw number into SQL', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const { sql, bindings } = compileSelect(
          {
            tableName: 't',
            selectColumns: ['id'],
            aggregates: [],
            isDistinct: false,
            joins: [],
            whereClauses: [{ type: 'basic', column: 'id', operator: '=', value: n, logical: 'AND' }],
            orWhereClauses: [],
            groupByColumns: [],
            havingClauses: [],
            orderClauses: [],
            unionParts: [],
          },
          'sqlite',
        );
        expect(sql).not.toContain(String(n));
        expect(bindings).toEqual([n]);
      }),
      { numRuns: 40 },
    );
  });
});
