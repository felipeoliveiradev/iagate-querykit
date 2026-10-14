import { describe, it, expect } from 'vitest'
import {
  getDialect,
  tryGetDialect,
  hasDialect,
  listDialects,
  registerDialect,
  resolveEngine,
  toDriverError,
  wrapDriverCall,
  wrapDriverSync,
  redactParams,
  normalizeDriverCode,
  hydrateInteger,
  hydrateRow,
  hydrateRows,
  UnsupportedFeatureError,
} from '../engine/index.js'
import { BindError, DriverError, QueryKitError } from '../sql/errors.js'
import { quoteIdent, quoteTableRef, quoteSelectItem, quoteIdentList, isSafeIdent } from '../sql/identifiers.js'
import { applyPaging, returningInsertSql } from '../sql/dialect.js'
import { beginSavepointSql, releaseSavepointSql, rollbackSavepointSql, savepointName } from '../adapters/savepoints.js'
import { createQueryKit } from '../querykit.js'
import { sqliteDialect } from '../dialects/sqlite/index.js'
import { defineDialect } from '../dialects/define.js'
import { makeQuoter } from '../dialects/quoting.js'
import { wrapDouble } from '../engine/idents.js'
import { hydrateResult } from '../adapters/driver-wrap.js'

describe('engine plugin registry', () => {
  it('lists built-ins and throws on unknown names', () => {
    expect(hasDialect('sqlite')).toBe(true)
    expect(listDialects()).toEqual(expect.arrayContaining(['sqlite', 'postgres', 'mysql', 'oracle', 'mssql', 'memory']))
    expect(tryGetDialect('no-such-engine')).toBeUndefined()
    expect(() => getDialect('no-such-engine')).toThrow(/Unknown dialect/)
    expect(resolveEngine(sqliteDialect).name).toBe('sqlite')
    expect(resolveEngine('postgres').name).toBe('postgres')
    expect(resolveEngine('nope').name).toBe('sqlite')
    expect(resolveEngine().name).toBe('sqlite')
    expect(quoteIdent('*', 'mysql')).toBe('*')
    expect(quoteIdent('*', 'mssql')).toBe('*')
  })

  it('identifier helpers fall back when the name is unregistered', () => {
    expect(quoteIdent('users', 'unregistered' as any)).toBe('"users"')
    expect(quoteIdent('a.b', 'unregistered' as any)).toBe('"a"."b"')
    expect(quoteTableRef('users AS u', 'unregistered' as any)).toBe('"users" AS "u"')
    expect(quoteTableRef('users u', 'unregistered' as any)).toBe('"users" "u"')
    expect(quoteTableRef('users', 'unregistered' as any)).toBe('"users"')
    expect(() => quoteTableRef('', 'unregistered' as any)).toThrow(/empty/)
    expect(quoteSelectItem('COUNT(*)', 'unregistered' as any)).toBe('COUNT(*)')
    expect(quoteSelectItem('COUNT(id) AS total', 'unregistered' as any)).toBe('COUNT(id) AS total')
    expect(quoteSelectItem('id as ident', 'unregistered' as any)).toBe('"id" AS "ident"')
    expect(quoteSelectItem('*', 'unregistered' as any)).toBe('*')
    expect(quoteSelectItem('email', 'unregistered' as any)).toBe('"email"')
    expect(() => quoteSelectItem('', 'unregistered' as any)).toThrow(/empty/)
    expect(quoteIdent('*')).toBe('*')
    expect(isSafeIdent('ok')).toBe(true)
    expect(isSafeIdent('no;pe')).toBe(false)
    expect(quoteIdentList(['a', 'b'])).toBe('"a", "b"')
  })

  it('paging / returning / savepoints no-op when the dialect is unknown', () => {
    const bindings: unknown[] = []
    expect(applyPaging('SELECT 1', 'unregistered' as any, 1, 0, bindings)).toBe('SELECT 1')
    expect(returningInsertSql('INSERT INTO t VALUES (1)', 'unregistered' as any)).toBe('INSERT INTO t VALUES (1)')
    expect(() => savepointName(-1)).toThrow(/non-negative/)
    expect(() => beginSavepointSql('sqlite', 'bad name')).toThrow(/Unsafe savepoint/)
    expect(beginSavepointSql('unregistered' as any, 'qk_sp_1')).toBe('SAVEPOINT qk_sp_1')
    expect(releaseSavepointSql('unregistered' as any, 'qk_sp_1')).toBe('RELEASE SAVEPOINT qk_sp_1')
    expect(rollbackSavepointSql('unregistered' as any, 'qk_sp_1')).toBe('ROLLBACK TO SAVEPOINT qk_sp_1')
  })
})

describe('DriverError mapping', () => {
  it('keeps QueryKitError code, redacts secrets, and wraps ORA/MSSQL numbers', async () => {
    const bind = new BindError('bad bind')
    const wrapped = toDriverError(bind, { sql: 'SELECT ?', bindings: ['password-super-secret'] })
    expect(wrapped).toBeInstanceOf(DriverError)
    expect(wrapped.cause).toBe(bind)
    expect(JSON.stringify(wrapped.params)).not.toMatch(/password-super-secret/)

    const again = toDriverError(wrapped)
    expect(again).toBe(wrapped)

    expect(normalizeDriverCode({ errorNum: 942 })).toBe('ORA-942')
    expect(normalizeDriverCode({ number: 208 })).toBe('MSSQL-208')
    expect(normalizeDriverCode({ errno: 19 })).toBe('ERRNO-19')
    expect(normalizeDriverCode(null)).toBe('DRIVER')

    await expect(wrapDriverCall(() => Promise.reject(new BindError('keep')))).rejects.toBeInstanceOf(BindError)
    expect(() => wrapDriverSync(() => { throw new BindError('keep') })).toThrow(BindError)
    expect(() => wrapDriverSync(() => { throw new Error('raw') })).toThrow(DriverError)

    const buf = Buffer.from('abcd')
    const redacted = redactParams([null, 1n, true, buf, { x: 1 }, 'short'])
    expect(redacted[1]).toMatchObject({ type: 'bigint' })
    expect(redacted[3]).toMatchObject({ type: 'buffer' })
  })

  it('UnsupportedFeatureError names the dialect', () => {
    const err = new UnsupportedFeatureError('regex')
    expect(err.code).toBe('UNSUPPORTED')
    expect(err.message).toMatch(/Unsupported feature/)
  })
})

describe('hydrate + createQueryKit options', () => {
  it('hydrates safe bigints and leaves huge ones', async () => {
    expect(hydrateInteger(1n)).toBe(1)
    expect(hydrateInteger(9007199254740993n)).toBe(9007199254740993n)
    expect(hydrateInteger('x')).toBe('x')
    expect(hydrateRow({ n: 2n }).n).toBe(2)
    expect(hydrateRows([{ n: 3n }])[0].n).toBe(3)
    expect(hydrateRow([5n] as any)[0]).toBe(5)
    expect(hydrateRow(null as any)).toBeNull()
    await expect(
      wrapDriverCall(() => {
        throw new QueryKitError('driver-ish', 'DRIVER')
      }),
    ).rejects.toBeInstanceOf(DriverError)
    expect(hydrateResult('sqlite', 4n)).toBe(4)
  })

  it('createQueryKit({ dialect, driver }) stamps dialect onto a bare driver', async () => {
    const rows: any[] = []
    const driver: any = {
      executeQuery: async (_sql: string, bindings: any[]) => {
        if (/INSERT/i.test(_sql)) rows.push({ id: 1, body: bindings[0] })
        return { data: rows }
      },
    }
    const kit = createQueryKit({ dialect: sqliteDialect, driver })
    expect(driver.dialect).toBe('sqlite')
    await kit.table('notes').insert({ body: 'hi' }).make()
    const found = await kit.table('notes').all()
    expect(found).toHaveLength(1)
  })
})

describe('registerDialect validation', () => {
  it('rejects a dialect without a name', () => {
    expect(() => registerDialect({} as any)).toThrow(/dialect.name/)
  })
})

describe('dialect method edges', () => {
  it('covers quoting + autoincrement + FTS match-only', async () => {
    expect(() => sqliteDialect.quoteTableRef('')).toThrow(/empty/)
    expect(() => sqliteDialect.quoteSelectItem('')).toThrow(/empty/)
    expect(sqliteDialect.quoteSelectItem('*')).toBe('*')
    expect(sqliteDialect.quoteSelectItem('COUNT(id) AS total')).toBe('COUNT(id) AS total')
    expect(sqliteDialect.quoteTableRef('users u')).toBe('"users" "u"')
    expect(sqliteDialect.autoIncrementSql?.('text' as any)).toBeUndefined()
    expect(sqliteDialect.autoIncrementSql?.('int')?.primaryKey).toBe(true)

    const { BetterSqlite3Executor } = await import('../adapters/better-sqlite3.js')
    const { QueryBuilder } = await import('../query-builder.js')
    const { setDefaultExecutor, resetQueryKitConfig } = await import('../config.js')
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT)')
    await expect(
      new QueryBuilder('docs').whereFullText(['body'], 'x', { mode: 'match' }).all(),
    ).rejects.toBeInstanceOf(DriverError)
    resetQueryKitConfig()
    db.close()
  })

  it('defineDialect defaults cover paging, JSON, FTS, dates, regex, catalogs', () => {
    const bare = defineDialect({
      name: 'bare',
      maxBindParams: 50,
      ...makeQuoter(wrapDouble),
    })
    const b: unknown[] = []
    expect(bare.applyPaging('SELECT 1', 2, 3, b)).toMatch(/LIMIT/)
    expect(bare.jsonContains('"m"', {}).sql).toMatch(/json/)
    expect(bare.jsonContains('"m"', { a: 1 }).bindings.length).toBe(2)
    expect(bare.jsonContains('"m"', ['x']).sql).toMatch(/json_each/)
    expect(bare.fullText('"t"', ['"c"'], ['c'], 'q', { mode: 'like' }).sql).toMatch(/LIKE/)
    expect(bare.fullText('"t"', ['"c"'], ['c'], 'q').sql).toMatch(/MATCH/)
    expect(bare.whereDate('"d"', new Date()).bindings).toHaveLength(2)
    expect(bare.whereRegex('"e"', '^ab$', '').sql).toMatch(/LIKE/)
    expect(bare.listColumnsQueries('"t"', 't').length).toBeGreaterThan(0)
    expect(bare.dropTableSql('"t"')).toMatch(/DROP TABLE/)
    expect(bare.ifNotExistsClause()).toMatch(/IF NOT EXISTS/)
  })
})
