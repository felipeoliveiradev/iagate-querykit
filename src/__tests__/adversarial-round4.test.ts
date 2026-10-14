import { describe, it, expect, afterEach } from 'vitest'
import { QueryBuilder } from '../query-builder.js'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'
import { createQueryKit } from '../querykit.js'
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js'
import {
  BindError,
  InsertError,
  QueryKitError,
  DIALECT_MAX_BIND_PARAMS,
  SQLITE_MAX_BIND_PARAMS_LEGACY,
  SQLITE_MAX_BIND_PARAMS_MODERN,
  maxBindParams,
  chunkRowsByBindLimit,
  UnsafeIdentifierError,
} from '../sql/index.js'
import { normalizeBinding } from '../sql/bindings.js'
import {
  savepointName,
  beginSavepointSql,
  releaseSavepointSql,
  rollbackSavepointSql,
} from '../adapters/savepoints.js'

describe('bind limits + insert chunking', () => {
  it('documents dialect ceilings including both SQLite numbers', () => {
    expect(DIALECT_MAX_BIND_PARAMS.sqlite).toBe(SQLITE_MAX_BIND_PARAMS_LEGACY)
    expect(SQLITE_MAX_BIND_PARAMS_MODERN).toBe(32766)
    expect(maxBindParams('mssql')).toBe(2100)
    expect(maxBindParams('postgres')).toBe(65535)
    expect(maxBindParams('mysql')).toBe(65535)
    expect(maxBindParams('oracle')).toBe(65535)
    expect(maxBindParams('sqlite', SQLITE_MAX_BIND_PARAMS_MODERN)).toBe(32766)
    expect(() => maxBindParams('sqlite', 0)).toThrow(/positive/)
  })

  it('chunks rows so each batch stays under the bind ceiling', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: i, b: i }))
    expect(chunkRowsByBindLimit(rows, 2, 5).map((c) => c.length)).toEqual([2, 2, 1])
    expect(chunkRowsByBindLimit(rows, 2, 999)).toHaveLength(1)
    expect(chunkRowsByBindLimit([], 2, 999)).toEqual([])
    expect(() => chunkRowsByBindLimit(rows, 0, 10)).toThrow(/columnsPerRow/)
  })

  it('make() splits a multi-row insert at the dialect limit (mocked)', async () => {
    const sqls: string[] = []
    const exec = {
      dialect: 'sqlite' as const,
      async executeQuery() { return { data: [] } },
      runSync(sql: string, bindings: any[]) {
        sqls.push(sql)
        return { changes: bindings.length, lastInsertRowid: bindings.length }
      },
    }
    setDefaultExecutor(exec as any)
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: i, b: i + 1 }))
    const res = await new QueryBuilder('t').maxBindings(6).insert(rows).make()
    expect(sqls).toHaveLength(2)
    expect(sqls[0]).toMatch(/VALUES \(\?, \?\), \(\?, \?\), \(\?, \?\)/)
    expect(sqls[1]).toMatch(/VALUES \(\?, \?\), \(\?, \?\)/)
    expect(res.changes).toBe(6 + 4)
    resetQueryKitConfig()
  })

  it('make() chunks at MSSQL 2100 and PG 65535 when forced', async () => {
    const seen: number[] = []
    const exec = {
      dialect: 'mssql' as const,
      async executeQuery() { return { data: [] } },
      async run(_sql: string, bindings: any[]) {
        seen.push(bindings.length)
        return { changes: bindings.length / 3, lastInsertRowid: 1 }
      },
    }
    setDefaultExecutor(exec as any)
    const cols = (n: number) => ({ a: n, b: n, c: n })
    const rows = Array.from({ length: 800 }, (_, i) => cols(i))
    await new QueryBuilder('t').insert(rows).make()
    expect(seen.every((n) => n <= 2100)).toBe(true)
    expect(seen.length).toBeGreaterThan(1)
    resetQueryKitConfig()

    seen.length = 0
    const pg = {
      dialect: 'postgres' as const,
      async executeQuery() { return { data: [] } },
      async run(_sql: string, bindings: any[]) {
        seen.push(bindings.length)
        return { changes: 1, lastInsertRowid: 1 }
      },
    }
    setDefaultExecutor(pg as any)
    const wide = Array.from({ length: 3 }, () => Object.fromEntries(Array.from({ length: 30000 }, (_, i) => [`c${i}`, i])))
    await new QueryBuilder('t').insert(wide as any).make()
    expect(seen.every((n) => n <= 65535)).toBe(true)
    expect(seen.length).toBeGreaterThan(1)
    resetQueryKitConfig()
  })

  it('rejects a single row that exceeds the bind limit', async () => {
    setDefaultExecutor({ dialect: 'sqlite', executeQuery: async () => ({ data: [] }), runSync: () => ({ changes: 0, lastInsertRowid: 0 }) } as any)
    const row: Record<string, number> = {}
    for (let i = 0; i < 1000; i++) row[`c${i}`] = i
    await expect(new QueryBuilder('t').insert(row).make()).rejects.toBeInstanceOf(InsertError)
    resetQueryKitConfig()
  })
})

describe('typed errors', () => {
  it('normalizeBinding throws BindError with a stable code', () => {
    try {
      normalizeBinding(undefined)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BindError)
      expect(err).toBeInstanceOf(QueryKitError)
      expect((err as BindError).code).toBe('BIND')
      expect((err as Error).message).toMatch(/undefined/)
    }
    expect(() => normalizeBinding(new Date('nope'))).toThrow(BindError)
    expect(() => normalizeBinding(Symbol('x'))).toThrow(BindError)
    expect(() => normalizeBinding(() => 1)).toThrow(BindError)
  })

  it('UnsafeIdentifierError is a QueryKitError', () => {
    try {
      new QueryBuilder('users;drop').toSql()
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeIdentifierError)
      expect(err).toBeInstanceOf(QueryKitError)
      expect((err as QueryKitError).code).toBe('UNSAFE_IDENTIFIER')
    }
  })

  it('maxBindings rejects non-integers', () => {
    expect(() => new QueryBuilder('t').maxBindings(1.5)).toThrow(InsertError)
    expect(() => new QueryBuilder('t').maxBindings(0)).toThrow(InsertError)
  })

  it('TransactionError and DriverError carry codes', async () => {
    const { TransactionError, DriverError } = await import('../sql/errors.js')
    const tx = new TransactionError('nested failed')
    expect(tx.code).toBe('TRANSACTION')
    expect(tx).toBeInstanceOf(QueryKitError)
    const drv = new DriverError('engine said no', new Error('root'))
    expect(drv.code).toBe('DRIVER')
    expect(drv.cause).toBeInstanceOf(Error)
  })
})

describe('mysql Date bind', () => {
  it('rewrites ISO-8601 UTC strings so DATETIME accepts them', async () => {
    const { mysqlBind } = await import('../adapters/mysql.js')
    expect(mysqlBind('2024-01-01T03:00:00.000Z')).toBe('2024-01-01 03:00:00.000')
    expect(mysqlBind('not-a-date')).toBe('not-a-date')
    expect(mysqlBind(1)).toBe(1)
  })
})

describe('savepoint SQL', () => {
  it('emits dialect-specific savepoint / release / rollback', () => {
    expect(savepointName(2)).toBe('qk_sp_2')
    expect(beginSavepointSql('postgres', 'qk_sp_1')).toBe('SAVEPOINT qk_sp_1')
    expect(beginSavepointSql('mssql', 'qk_sp_1')).toBe('SAVE TRANSACTION qk_sp_1')
    expect(releaseSavepointSql('mysql', 'qk_sp_1')).toBe('RELEASE SAVEPOINT qk_sp_1')
    expect(releaseSavepointSql('mssql', 'qk_sp_1')).toBeNull()
    expect(releaseSavepointSql('oracle', 'qk_sp_1')).toBeNull()
    expect(rollbackSavepointSql('sqlite', 'qk_sp_1')).toBe('ROLLBACK TO SAVEPOINT qk_sp_1')
    expect(rollbackSavepointSql('mssql', 'qk_sp_1')).toBe('ROLLBACK TRANSACTION qk_sp_1')
    expect(() => beginSavepointSql('sqlite', 'x;drop')).toThrow(/Unsafe savepoint/)
  })
})

describe('live sqlite: nesting, types, batches', () => {
  afterEach(() => resetQueryKitConfig())

  it('nested transactions commit inner and roll back only the savepoint', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    const kit = createQueryKit(db)
    db.executeQuerySync('CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)')
    await kit.transaction(async (outer) => {
      await outer.table('t').insert({ email: 'keep@x.com' }).make()
      await expect(
        outer.transaction(async (inner) => {
          await inner.table('t').insert({ email: 'gone@x.com' }).make()
          throw new Error('inner-fail')
        }),
      ).rejects.toThrow('inner-fail')
      await outer.table('t').insert({ email: 'also@x.com' }).make()
    })
    const rows = await kit.table('t').orderBy('id').all<{ email: string }>()
    expect(rows.map((r) => r.email)).toEqual(['keep@x.com', 'also@x.com'])
    db.close()
  })

  it('chunks a 400-row insert under the SQLite 999 ceiling and still writes every row', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE t (id INTEGER PRIMARY KEY, a INT, b INT, c INT)')
    const rows = Array.from({ length: 400 }, (_, i) => ({ a: i, b: i, c: i }))
    const res = await new QueryBuilder('t').insert(rows).make()
    expect(res.changes).toBe(400)
    const n = await new QueryBuilder('t').count().scalar<number>('count')
    expect(Number(n)).toBe(400)
    db.close()
  })

  it('modern SQLite ceiling (32766) keeps a 2000x2 insert in one statement', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE t (id INTEGER PRIMARY KEY, a INT, b INT)')
    const rows = Array.from({ length: 2000 }, (_, i) => ({ a: i, b: i }))
    const res = await new QueryBuilder('t').maxBindings(SQLITE_MAX_BIND_PARAMS_MODERN).insert(rows).make()
    expect(res.changes).toBe(2000)
    db.close()
  })

  it('Date timezone round-trips as UTC ISO, BigInt/Buffer/JSON survive', async () => {
    const db = new BetterSqlite3Executor(':memory:', { safeIntegers: true })
    setDefaultExecutor(db)
    db.executeQuerySync(
      'CREATE TABLE t (id INTEGER PRIMARY KEY, when_at TEXT, n INTEGER, blob BLOB, meta TEXT)',
    )
    const when = new Date('2024-01-01T00:00:00-03:00')
    const blob = Buffer.from('hello-blob')
    await new QueryBuilder('t').insert({
      when_at: when,
      n: 9007199254740993n,
      blob,
      meta: { tag: 'ok', n: 1 },
    }).make()
    const row = await new QueryBuilder('t').first<any>()
    expect(row.when_at).toBe('2024-01-01T03:00:00.000Z')
    expect(new Date(row.when_at).getTime()).toBe(when.getTime())
    expect(row.n === 9007199254740993n || String(row.n) === '9007199254740993').toBe(true)
    expect(Buffer.isBuffer(row.blob) ? row.blob.equals(blob) : Buffer.from(row.blob).equals(blob)).toBe(true)
    expect(typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta).toEqual({ tag: 'ok', n: 1 })
    db.close()
  })

  it('whereJsonContains matches stored JSON and driver errors keep their message', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE t (id INTEGER PRIMARY KEY, meta TEXT)')
    await new QueryBuilder('t').insert({ meta: { role: 'admin' } }).make()
    const hit = await new QueryBuilder('t').whereJsonContains('meta', { role: 'admin' }).all<any>()
    expect(hit).toHaveLength(1)
    await expect(db.executeQuery('SELECT nope FROM missing', [])).rejects.toThrow(/no such table|no such column|missing/i)
    db.close()
  })
})
