import { describe, it, expect, afterEach } from 'vitest'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'
import { runDialectConformance } from '../engine/conformance.js'
import { registerDialect, listDialects } from '../engine/registry.js'
import { sqliteDialect } from '../dialects/sqlite/index.js'
import { postgresDialect } from '../dialects/postgres/index.js'
import { mysqlDialect } from '../dialects/mysql/index.js'
import { oracleDialect } from '../dialects/oracle/index.js'
import { mssqlDialect } from '../dialects/mssql/index.js'
import { memoryDialect } from '../dialects/memory/index.js'
import { defineDialect } from '../dialects/define.js'
import { makeQuoter } from '../dialects/quoting.js'
import { wrapDouble } from '../engine/idents.js'
import { createQueryKit } from '../querykit.js'
import { QueryBuilder } from '../query-builder.js'
import { DriverError } from '../sql/errors.js'
import { UnsupportedFeatureError } from '../engine/errors.js'
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js'

describe('dialect conformance (compile-time)', () => {
  it.each([
    ['sqlite', sqliteDialect],
    ['postgres', postgresDialect],
    ['mysql', mysqlDialect],
    ['oracle', oracleDialect],
    ['mssql', mssqlDialect],
    ['memory', memoryDialect],
  ] as const)('%s plugin satisfies the contract', async (_name, dialect) => {
    await runDialectConformance({ dialect })
  })
})

describe('dialect conformance (live sqlite / memory)', () => {
  afterEach(() => resetQueryKitConfig())

  it('sqlite driver + dialect', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    try {
      await runDialectConformance({ dialect: sqliteDialect, driver: db })
    } finally {
      db.close()
    }
  })

  it('memory dialect on a throwaway sqlite driver (no core change)', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    try {
      await runDialectConformance({ dialect: memoryDialect, driver: db })
    } finally {
      db.close()
    }
  })
})

describe('plugin API — add a database without touching core', () => {
  afterEach(() => resetQueryKitConfig())

  it('registerDialect + createQueryKit({ dialect, driver })', async () => {
    const q = makeQuoter(wrapDouble)
    const toy = defineDialect({
      name: 'toy',
      maxBindParams: 99,
      ...q,
      capabilities: { fts5: false, regex: false },
      fullText: (_t, cols, _r, query) => ({
        sql: `(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`,
        bindings: cols.map(() => `%${query}%`),
      }),
    })
    registerDialect(toy)
    expect(listDialects()).toContain('toy')

    const driver = new BetterSqlite3Executor(':memory:')
    driver.executeQuerySync('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)')
    const kit = createQueryKit({ dialect: toy, driver })
    await kit.table('notes').insert({ body: 'hello toy' }).make()
    const rows = await kit.table('notes').whereFullText(['body'], 'toy', { mode: 'like' }).all<{ body: string }>()
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toBe('hello toy')
    kit.close()
  })

  it('UnsupportedFeatureError from a dialect stays typed', () => {
    expect(() => memoryDialect.whereRegex('"email"', 'x', 'i')).toThrow(UnsupportedFeatureError)
  })
})

describe('DriverError wrap + FTS fallback + BigInt default', () => {
  afterEach(() => resetQueryKitConfig())

  it('wraps driver exceptions with cause, sql, and redacted params', () => {
    const db = new BetterSqlite3Executor(':memory:')
    try {
      expect(() => db.executeQuerySync('SELECT * FROM missing_table WHERE secret = ?', ['super-secret-token'])).toThrow(
        DriverError,
      )
      try {
        db.executeQuerySync('SELECT * FROM missing_table WHERE secret = ?', ['super-secret-token'])
      } catch (err) {
        const e = err as DriverError
        expect(e.code).toBe('DRIVER')
        expect(e.cause).toBeTruthy()
        expect(e.sql).toMatch(/missing_table/)
        expect(JSON.stringify(e.params)).not.toMatch(/super-secret-token/)
        expect(e.driverCode).toBeTruthy()
      }
    } finally {
      db.close()
    }
  })

  it('whereFullText mode=like works on a regular table', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT)')
    await new QueryBuilder('docs').insert({ title: 'QueryKit', body: 'typed SQL toolkit' }).make()
    const hits = await new QueryBuilder('docs')
      .whereFullText(['title', 'body'], 'toolkit', { mode: 'like' })
      .all<{ title: string }>()
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('QueryKit')
    db.close()
  })

  it('whereFullText mode=auto falls back to LIKE when there is no FTS table', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT)')
    await new QueryBuilder('docs').insert({ title: 'QueryKit', body: 'typed SQL toolkit' }).make()
    const compiled = new QueryBuilder('docs').whereFullText(['title', 'body'], 'toolkit').toSql()
    expect(compiled.sql).toMatch(/MATCH/)
    const hits = await new QueryBuilder('docs').whereFullText(['title', 'body'], 'toolkit').all<{ title: string }>()
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('QueryKit')
    db.close()
  })

  it('safe integers are on by default; values inside MAX_SAFE_INTEGER stay numbers', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    db.executeQuerySync('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)')
    db.runSync('INSERT INTO t (n) VALUES (?)', [1])
    db.runSync('INSERT INTO t (n) VALUES (?)', [9007199254740993n])
    const rows = db.executeQuerySync('SELECT n FROM t ORDER BY id').data
    expect(rows[0].n).toBe(1)
    expect(typeof rows[0].n).toBe('number')
    expect(rows[1].n === 9007199254740993n || String(rows[1].n) === '9007199254740993').toBe(true)
    db.close()
  })
})
