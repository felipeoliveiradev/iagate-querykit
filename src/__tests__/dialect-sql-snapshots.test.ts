import { describe, it, expect, afterEach } from 'vitest'
import { QueryBuilder } from '../query-builder.js'
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js'
import type { SqlDialect } from '../sql/dialect.js'
import { quoteIdent, quoteTableRef } from '../sql/identifiers.js'
import { toOracleParams, toMssqlParams, toPostgresParams } from '../sql/placeholders.js'
import { migration, ColumnType, ColumnDefault } from '../migration-dsl.js'
import { migrateUp, resetMigrations } from '../migration-manager.js'

function exec(dialect: SqlDialect) {
  return {
    dialect,
    executeQuery: async () => ({ data: [] }),
    executeQuerySync: () => ({ data: [] }),
  }
}

function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) || []).length
}

describe('Oracle / SQL Server SQL snapshots', () => {
  afterEach(() => resetQueryKitConfig())

  it('quotes identifiers with dialect wrappers', () => {
    expect(quoteIdent('order', 'oracle')).toBe('"order"')
    expect(quoteIdent('order', 'mssql')).toBe('[order]')
    expect(quoteTableRef('users AS u', 'mssql')).toBe('[users] AS [u]')
    expect(() => quoteIdent('a]b', 'mssql')).toThrow(/Unsafe/)
  })

  it('compiles paging, JSON, FTS, regex, nearby, date-range, and upsert-shaped writes', () => {
    for (const dialect of ['oracle', 'mssql'] as const) {
      setDefaultExecutor(exec(dialect) as any)
      const q = new QueryBuilder('users')
        .select(['id', 'email'])
        .where('active', '=', 1)
        .whereJsonContains('meta', { a: 1 })
        .whereFullText(['email', 'bio'], 'kit')
        .whereRegex('email', '^a', dialect === 'oracle' ? 'i' : '')
        .whereNearby('lat', 'lng', 1, 2, 5)
        .whereDateRangeTz('created_at', new Date('2024-01-01T00:00:00Z'), new Date('2024-01-31T00:00:00Z'), 'UTC')
        .orderBy('id')
        .limit(10)
        .offset(5)
      const { sql, bindings } = q.toSql()
      expect(sql).toMatch(/OFFSET \? ROWS FETCH NEXT \? ROWS ONLY/)
      expect(bindings.length).toBeGreaterThan(10)
      expect(sql).toMatch(/\?/)
      if (dialect === 'oracle') {
        expect(sql).toContain('"users"')
        expect(sql).toMatch(/JSON_EXISTS/)
        expect(sql).toMatch(/CONTAINS\("email"/)
        expect(sql).toMatch(/REGEXP_LIKE\("email"/)
        expect(sql).toMatch(/FROM_TZ\("created_at"/)
      } else {
        expect(sql).toContain('[users]')
        expect(sql).toMatch(/OPENJSON/)
        expect(sql).toMatch(/CONTAINS\(\[email\]/)
        expect(sql).toMatch(/\[created_at\] AT TIME ZONE/)
      }
    }
  })

  it('converts placeholders without touching literals', () => {
    const sql = `SELECT * FROM t WHERE a = ? AND b = '?' AND c LIKE '%?%'`
    expect(toOracleParams(sql)).toBe(`SELECT * FROM t WHERE a = :1 AND b = '?' AND c LIKE '%?%'`)
    const ms = toMssqlParams(sql)
    expect(ms.sql).toBe(`SELECT * FROM t WHERE a = @p1 AND b = '?' AND c LIKE '%?%'`)
    expect(ms.paramNames).toEqual(['p1'])
    expect(toPostgresParams(`SELECT x ?| ?`)).toMatch(/\$1/)
  })

  it('migration DSL emits dialect-specific types for oracle and mssql', async () => {
    class Capture {
      constructor(public dialect: SqlDialect) {}
      seen: string[] = []
      async executeQuery(sql: string) {
        if (/querykit_migrations/i.test(sql)) return { data: [] }
        this.seen.push(sql)
        return { data: [] }
      }
      executeQuerySync(sql: string) {
        if (/querykit_migrations/i.test(sql)) return { data: [] }
        this.seen.push(sql)
        return { data: [] }
      }
    }
    const up = migration((b) => {
      b.createTable('items', {
        id: { type: ColumnType.Int, primaryKey: true, autoIncrement: true },
        name: { type: ColumnType.String, length: 80, notNull: true },
        price: { type: ColumnType.Decimal, precision: 10, scale: 2 },
        active: { type: ColumnType.Boolean, default: true },
        meta: { type: ColumnType.Json },
        when: { type: ColumnType.TimestampTz, default: ColumnDefault.CurrentTimestamp },
      })
    })
    for (const dialect of ['oracle', 'mssql'] as const) {
      const cap = new Capture(dialect)
      setDefaultExecutor(cap as any)
      await resetMigrations({ executor: cap as any })
      await migrateUp([{ id: `${dialect}_items`, up }], { executor: cap as any })
      const sql = cap.seen.join('\n')
      if (dialect === 'oracle') {
        expect(sql).toMatch(/NUMBER|VARCHAR2|CLOB|TIMESTAMP WITH TIME ZONE|GENERATED/)
      } else {
        expect(sql).toMatch(/IDENTITY|NVARCHAR|BIT|DATETIMEOFFSET|GETDATE/)
      }
    }
  })

  it('selectAllExcept cannot introspect oracle/mssql', async () => {
    setDefaultExecutor(exec('oracle') as any)
    await expect(new QueryBuilder('users').selectAllExcept(['password']).all()).rejects.toThrow(
      /cannot introspect/,
    )
    setDefaultExecutor(exec('mssql') as any)
    await expect(new QueryBuilder('users').selectAllExcept(['password']).all()).rejects.toThrow(
      /cannot introspect/,
    )
  })
})
