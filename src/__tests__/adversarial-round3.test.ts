import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryBuilder } from '../query-builder.js'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'
import { createQueryKit } from '../querykit.js'
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js'
import { BaseDatabaseAdapter } from '../database-adapters/base-adapter.js'
import { escapeSqlLiteral, inlineBindings } from '../sql/literals.js'
import type { SqlDialect } from '../sql/dialect.js'

function dialectExec(dialect: SqlDialect) {
  return {
    dialect,
    executeQuery: async () => ({ data: [] }),
    executeQuerySync: () => ({ data: [] }),
  }
}

function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) || []).length
}

describe('adversarial round 3 regressions', () => {
  let exec: BetterSqlite3Executor
  let kit: ReturnType<typeof createQueryKit>

  beforeEach(() => {
    resetQueryKitConfig()
    exec = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(exec)
    kit = createQueryKit(exec)
    exec.executeQuerySync(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT,
        name TEXT,
        n INTEGER
      )
    `)
    exec.executeQuerySync("INSERT INTO users (email, name, n) VALUES ('Ada@x.com', 'Ada', 1), ('bob@x.com', 'Bob', 2)")
  })

  afterEach(() => {
    exec.close()
    resetQueryKitConfig()
  })

  it('whereRelevanceSearch binds SELECT score placeholders (they must not steal WHERE bindings)', async () => {
    const { sql, bindings } = new QueryBuilder('users')
      .whereRelevanceSearch('Ada', ['name', 'email'], [3, 1])
      .toSql()
    expect(bindings.length).toBe(countPlaceholders(sql))
    expect(bindings.filter((b) => b === '%Ada%')).toHaveLength(4)
    const rows = await kit.table('users').whereRelevanceSearch('Ada', ['name', 'email'], [3, 1]).all<any>()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Ada')
    expect(rows[0].relevance_score).toBeGreaterThan(0)
  })

  it('whereRelevanceSearch rejects non-finite weights', () => {
    expect(() =>
      new QueryBuilder('users').whereRelevanceSearch('x', ['name'], [Number.NaN]),
    ).toThrow(/finite/)
  })

  it('whereFuzzySearch validates threshold before mutating the builder', () => {
    const qb = new QueryBuilder('users')
    expect(() => qb.whereFuzzySearch('Ada', ['name'], 1.5)).toThrow(/threshold/)
    expect(qb.toSql().sql).not.toMatch(/WHERE/)
    expect(() => qb.whereFuzzySearch('Ada', ['name'], Number.NaN)).toThrow(/threshold/)
  })

  it('whereRegex quotes the column and honors the i flag per dialect', () => {
    setDefaultExecutor(dialectExec('postgres') as any)
    const ci = new QueryBuilder('users').use(dialectExec('postgres') as any).whereRegex('email', 'Ada', 'i').toSql()
    expect(ci.sql).toMatch(/"email" ~\* \?/)
    const cs = new QueryBuilder('users').use(dialectExec('postgres') as any).whereRegex('email', 'Ada', '').toSql()
    expect(cs.sql).toMatch(/"email" ~ \?/)
    expect(cs.sql).not.toMatch(/~\*/)

    const my = new QueryBuilder('users').use(dialectExec('mysql') as any).whereRegex('email', 'Ada', '').toSql()
    expect(my.sql).toMatch(/`email` REGEXP BINARY \?/)

    const ora = new QueryBuilder('users').use(dialectExec('oracle') as any).whereRegex('email', 'Ada', 'i').toSql()
    expect(ora.sql).toMatch(/REGEXP_LIKE\("email", \?, \?\)/)
    expect(ora.bindings).toEqual(['Ada', 'i'])
  })

  it('whereRegex uses the bound executor, not the global default dialect', () => {
    setDefaultExecutor(dialectExec('sqlite') as any)
    const { sql } = new QueryBuilder('users').use(dialectExec('postgres') as any).whereRegex('email', 'x', 'i').toSql()
    expect(sql).toMatch(/~\*/)
    expect(sql).not.toMatch(/LIKE/)
  })

  it('stats quotes hostile customColumns instead of interpolating them', () => {
    expect(() => new QueryBuilder('users').stats({ customColumns: ['id) FROM users--'] }).toSql()).toThrow(
      /Unsafe/,
    )
    const { sql } = new QueryBuilder('users').stats({ customColumns: ['email'] }).toSql()
    expect(sql).toMatch(/COUNT\(CASE WHEN "email" IS NOT NULL/)
    expect(sql).toContain('email_not_null_count')
  })

  it('selectRowNumber quotes alias + order columns and runs on SQLite', async () => {
    expect(() => new QueryBuilder('users').selectRowNumber('n;drop').toSql()).toThrow(/Unsafe/)
    const { sql } = new QueryBuilder('users').orderBy('id').selectRowNumber('pos').toSql()
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(ORDER BY "id" ASC\) AS "pos"/)
    const rows = await kit.table('users').orderBy('id').selectRowNumber('pos').all<any>()
    expect(rows.map((r) => r.pos)).toEqual([1, 2])
  })

  it('whereDateRangeTz quotes the column and emits timezone SQL on mssql', () => {
    const start = new Date('2024-01-01T00:00:00Z')
    const end = new Date('2024-01-31T00:00:00Z')
    const { sql, bindings } = new QueryBuilder('users')
      .use(dialectExec('mssql') as any)
      .whereDateRangeTz('created_at', start, end, 'UTC')
      .toSql()
    expect(sql).toMatch(/\[created_at\] AT TIME ZONE 'UTC' AT TIME ZONE \? BETWEEN \? AND \?/)
    expect(bindings[0]).toBe('UTC')
  })

  it('whereMultiSearch honors operator OR and LIKE_CI extra columns', () => {
    const { sql } = new QueryBuilder('users')
      .where('n', '=', 1)
      .whereMultiSearch([
        { columns: ['name', 'email'], type: 'LIKE_CI', value: '%ada%', operator: 'OR' },
      ])
      .toSql()
    expect(sql).toMatch(/OR \(/)
    expect(sql).toMatch(/LOWER\("name"\) LIKE LOWER\(\?\)/)
    expect(sql).toMatch(/LOWER\("email"\) LIKE LOWER\(\?\)/)
  })

  it('whereFullText / whereNearby reject bad inputs', () => {
    expect(() => new QueryBuilder('users').whereFullText([], 'x')).toThrow(/column/)
    expect(() => new QueryBuilder('users').whereNearby('n', 'n', 1, 2, -4)).toThrow(/radius/)
  })
})

describe('coverage helpers', () => {
  afterEach(() => resetQueryKitConfig())

  it('createQueryKit validates executor + dialect and transaction support', async () => {
    expect(() => createQueryKit(null as any)).toThrow(/executeQuery/)
    expect(() => createQueryKit({ executeQuery: async () => ({ data: [] }) } as any)).toThrow(/dialect/)
    const exec = {
      dialect: 'sqlite' as const,
      executeQuery: async () => ({ data: [] }),
    }
    const kit = createQueryKit(exec)
    await expect(kit.transaction(async () => 1)).rejects.toThrow(/transactions/)
    expect(kit.close()).toBeUndefined()
    expect(kit.query('t')).toBeInstanceOf(QueryBuilder)
  })

  it('BaseDatabaseAdapter throws on unimplemented backup/restore/info', async () => {
    class Tiny extends BaseDatabaseAdapter {
      async connect() {}
      async disconnect() {}
      isConnectedToDatabase() {
        return false
      }
      async executeQuery() {
        return { data: [] }
      }
    }
    const a = new Tiny({ name: 't', type: 'sqlite' })
    expect(a.dialect).toBe('sqlite')
    expect(a.getConfig().name).toBe('t')
    await expect(a.backup('/tmp/x')).rejects.toThrow(/backup/)
    await expect(a.restore('/tmp/x')).rejects.toThrow(/restore/)
    await expect(a.getConnectionInfo()).rejects.toThrow(/getConnectionInfo/)
    await a.close()
  })

  it('escapeSqlLiteral / inlineBindings cover remaining branches', () => {
    expect(escapeSqlLiteral(null)).toBe('NULL')
    expect(escapeSqlLiteral(undefined)).toBe('NULL')
    expect(escapeSqlLiteral(10n)).toBe('10')
    expect(escapeSqlLiteral(true)).toBe('1')
    expect(escapeSqlLiteral(false)).toBe('0')
    expect(escapeSqlLiteral(Number.NaN)).toBe("'NaN'")
    expect(escapeSqlLiteral(new Date('2024-01-01T00:00:00.000Z'))).toBe("'2024-01-01T00:00:00.000Z'")
    expect(escapeSqlLiteral(Buffer.from('ab'))).toBe("X'6162'")
    expect(escapeSqlLiteral({ a: "b'c" })).toContain("b''c")
    expect(inlineBindings('SELECT ? -- ?\n, ?', [1, 2])).toBe('SELECT 1 -- ?\n, 2')
    expect(inlineBindings("SELECT '?' /* ? */, ?", [9])).toBe("SELECT '?' /* ? */, 9")
    expect(inlineBindings('SELECT ?', [])).toBe('SELECT ?')
    expect(inlineBindings("SELECT ''?", [1])).toMatch(/1/)
  })
})
