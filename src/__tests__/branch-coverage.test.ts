import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryBuilder } from '../query-builder.js'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'
import { SqlServerExecutor } from '../adapters/sqlserver.js'
import { OracleExecutor } from '../adapters/oracle.js'
import {
  setDefaultExecutor,
  resetQueryKitConfig,
  setRelations,
  setDefaultDialect,
  setEventBus,
  setSimulationController,
  setMultiDbRegistry,
  setDatabaseName,
  setTableToDatabase,
  setExecutorResolver,
  getExecutorForTable,
} from '../config.js'
import { attachRelations } from '../relations-resolver.js'
import { quoteIdent, quoteTableRef, quoteSelectItem, quoteIdentList, isSafeIdent } from '../sql/identifiers.js'
import { normalizeBinding } from '../sql/bindings.js'
import { createQueryKit } from '../querykit.js'
import { runSeed } from '../seed.js'
import { table } from '../table.js'
import { TriggerManager } from '../trigger-manager.js'
import { normalizeDialect, isSelectLike, applyPaging, returningInsertSql } from '../sql/dialect.js'
import { toOracleParams, toMssqlParams } from '../sql/placeholders.js'
import type { SqlDialect } from '../sql/dialect.js'

function dialectExec(dialect: SqlDialect, rows: any[] = []) {
  return {
    dialect,
    executeQuery: async (sql: string) => {
      if (/SHOW COLUMNS/i.test(sql)) return { data: [{ Field: 'id' }, { Field: 'email' }, { Field: 'password' }] }
      if (/information_schema/i.test(sql)) {
        return { data: [{ column_name: 'id' }, { column_name: 'email' }, { column_name: 'password' }] }
      }
      return { data: rows }
    },
    executeQuerySync: () => ({ data: rows }),
  }
}

describe('branch coverage extras', () => {
  afterEach(() => {
    resetQueryKitConfig()
    delete (globalThis as any).__vitest_mocks__
  })

  it('sqlserver wraps an existing pool, maps ID/rowsAffected, and skips close', async () => {
    ;(globalThis as any).__vitest_mocks__ = {
      mssql: {
        ConnectionPool: function () {
          return { connect: async () => ({ close: async () => {} }) }
        },
        Transaction: function () {
          return {
            begin: async () => {},
            commit: async () => {},
            rollback: async () => {
              throw new Error('already rolled back')
            },
          }
        },
        Request: function () {
          return {
            input() {
              return this
            },
            query: async () => ({ recordset: [{ ID: 11 }], rowsAffected: [1, 2] }),
          }
        },
      },
    }
    const pool = {
      request() {
        return {
          input() {
            return this
          },
          query: async () => ({ recordset: [{ ID: 7 }], rowsAffected: 3 }),
        }
      },
    }
    const borrowed = new SqlServerExecutor({ pool })
    const res = await borrowed.executeQuery('SELECT 1', [])
    expect(res.lastInsertId).toBe(7)
    expect(res.affectedRows).toBe(3)
    await borrowed.run('UPDATE t SET a = 1', [])
    await borrowed.close()

    const owned = new SqlServerExecutor({ user: 'sa', password: 'x', server: '127.0.0.1', pool: { max: 2, min: 0 } })
    await expect(
      owned.transaction(async (tx) => {
        await tx.run!('SELECT 1', [])
        throw new Error('fail-tx')
      }),
    ).rejects.toThrow('fail-tx')
    await owned.close()
  })

  it('sqlserver close swallows a rejected connect', async () => {
    ;(globalThis as any).__vitest_mocks__ = {
      mssql: {
        ConnectionPool: function () {
          return {
            connect: async () => {
              throw new Error('nope')
            },
          }
        },
      },
    }
    const exec = new SqlServerExecutor({ user: 'sa', password: 'x' })
    await exec.close()
  })

  it('oracle close ignores a pool without close()', async () => {
    ;(globalThis as any).__vitest_mocks__ = {
      oracledb: {
        OUT_FORMAT_OBJECT: 1,
        createPool: async () => ({
          getConnection: async () => ({
            execute: async () => ({ rows: [], rowsAffected: 0 }),
            close: async () => {
              throw new Error('busy')
            },
          }),
        }),
      },
    }
    const exec = new OracleExecutor({ user: 'u', password: 'p', connectString: 'x' })
    await exec.executeQuery('SELECT 1 FROM dual', [])
    await exec.close()
  })

  it('selectAllExcept introspects mysql and postgres column lists', async () => {
    setDefaultExecutor(dialectExec('mysql') as any)
    const my = await new QueryBuilder('users').selectAllExcept(['password']).all<any>()
    expect(Array.isArray(my)).toBe(true)

    setDefaultExecutor(dialectExec('postgres') as any)
    const pg = await new QueryBuilder('users').selectAllExcept(['password']).all<any>()
    expect(Array.isArray(pg)).toBe(true)
  })

  it('whereILike / orWhereILike emit dialect SQL', () => {
    for (const [dialect, needle] of [
      ['postgres', 'ILIKE'],
      ['mysql', 'utf8_general_ci'],
      ['oracle', 'UPPER('],
      ['mssql', 'SQL_Latin1_General_CP1_CI_AS'],
      ['sqlite', 'LOWER('],
    ] as const) {
      setDefaultExecutor(dialectExec(dialect) as any)
      const { sql } = new QueryBuilder('users').whereILike('email', '%a%').orWhereILike('name', '%b%').toSql()
      expect(sql).toContain(needle)
    }
  })

  it('whereMultiSearch extra-column branches and empty columns', () => {
    setDefaultExecutor(dialectExec('sqlite') as any)
    const { sql } = new QueryBuilder('products')
      .whereMultiSearch([
        { columns: [], type: 'LIKE', value: 'x' },
        { columns: ['a', 'b'], type: 'NOT IN', value: ['z'] },
        { columns: ['c', 'd'], type: 'NOT IN', value: 'z' },
        { columns: ['e', 'f'], type: 'BETWEEN', value: [1, 2] },
        { columns: ['g', 'h'], type: 'BETWEEN', value: [1] },
        { columns: ['i', 'j'], type: 'BETWEEN', value: 3 },
        { columns: ['k', 'l'], type: 'IN', value: 'solo' },
        { columns: ['m', 'n'], type: 'CONTAINS', value: 'x' },
        { columns: ['o', 'p'], type: 'STARTS_WITH', value: 'x' },
        { columns: ['q', 'r'], type: 'ENDS_WITH', value: 'x' },
        { columns: ['s', 't'], type: '>=', value: 1 },
      ])
      .toSql()
    expect(sql).toMatch(/WHERE/)
  })

  it('config routing: resolver, banks, table map, default dialect', () => {
    const exec = dialectExec('sqlite')
    setExecutorResolver((t) => (t === 'hit' ? (exec as any) : undefined))
    expect(getExecutorForTable('hit')).toBe(exec)
    setMultiDbRegistry({
      getAdapter(name: string) {
        if (name === 'missing') throw new Error('nope')
        return exec as any
      },
    })
    setTableToDatabase({ users: 'main' })
    setDatabaseName('main')
    expect(getExecutorForTable('other', ['missing', 'main'])).toBe(exec)
    expect(getExecutorForTable('users')).toBe(exec)
    setEventBus({ emit() {} })
    setSimulationController({
      isActive: () => false,
      getStateFor: () => undefined,
      updateStateFor() {},
      start() {},
      stop() {},
    })
    setDefaultDialect('mysql')
  })

  it('dialect helpers leftover branches', () => {
    expect(normalizeDialect('postgresql')).toBe('postgres')
    expect(normalizeDialect('nope', 'mysql')).toBe('mysql')
    expect(isSelectLike('')).toBe(false)
    expect(isSelectLike('SHOW TABLES')).toBe(true)
    expect(isSelectLike('DESCRIBE users')).toBe(true)
    const bindings: unknown[] = []
    const oraOff = applyPaging('SELECT 1 FROM t', 'oracle', undefined, 3, bindings)
    expect(oraOff).toMatch(/OFFSET \? ROWS/)
    expect(oraOff).toMatch(/ORDER BY 1/)
    expect(returningInsertSql('UPDATE t SET a=1', 'postgres')).toBe('UPDATE t SET a=1')
    expect(returningInsertSql('INSERT INTO t (id) VALUES (1)', 'mssql')).toMatch(/OUTPUT INSERTED/)
    expect(toOracleParams("SELECT '''' FROM t WHERE a = ?")).toMatch(/:1/)
    expect(toMssqlParams("SELECT 'it\\'s' FROM t WHERE a = ?").sql).toMatch(/@p1/)
  })

  it('whereArrayContains per dialect', () => {
    for (const [dialect, needle] of [
      ['postgres', 'ANY('],
      ['mysql', 'FIND_IN_SET'],
      ['oracle', 'ODCIVARCHAR2LIST'],
      ['mssql', 'STRING_SPLIT'],
      ['sqlite', 'LIKE'],
    ] as const) {
      setDefaultExecutor(dialectExec(dialect) as any)
      expect(new QueryBuilder('users').whereArrayContains('tags', 'admin').toSql().sql).toContain(needle)
    }
  })

  it('identifiers and bindings leftover branches', () => {
    expect(quoteTableRef('users u', 'sqlite')).toBe('"users" "u"')
    expect(quoteSelectItem('COUNT(id) AS total', 'sqlite')).toBe('COUNT(id) AS total')
    expect(quoteSelectItem('email AS login', 'sqlite')).toBe('"email" AS "login"')
    expect(quoteIdentList(['a', 'b'], 'mysql')).toBe('`a`, `b`')
    expect(isSafeIdent('ok')).toBe(true)
    expect(isSafeIdent('bad;drop')).toBe(false)
    expect(() => normalizeBinding(new Date('not-a-date'))).toThrow(/invalid Date/)
    expect(() => normalizeBinding(Symbol('x'))).toThrow(/symbol/)
    expect(() => normalizeBinding(() => 1)).toThrow(/function/)
  })

  it('manyToMany with join rows but no matching rights, and empty local ids', async () => {
    const exec = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(exec)
    exec.executeQuerySync('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)')
    exec.executeQuerySync('CREATE TABLE tags (id INTEGER PRIMARY KEY, slug TEXT)')
    exec.executeQuerySync('CREATE TABLE posts_tags (posts_id INTEGER, tags_id INTEGER)')
    exec.executeQuerySync('INSERT INTO posts_tags (posts_id, tags_id) VALUES (1, 99)')
    setRelations({
      posts: [
        {
          name: 'tags',
          kind: 'manyToMany',
          table: 'tags',
          through: { table: 'posts_tags', leftKey: 'posts_id', rightKey: 'tags_id' },
        },
      ],
    })
    const dangling = await attachRelations('posts', [{ id: 1, title: 'x' }])
    expect(dangling[0].tags).toEqual([])
    const empty = await attachRelations('posts', [{ id: null, title: 'y' }])
    expect(empty[0].tags).toEqual([])
    exec.close()
  })

  it('seed truncate via executeQuery when run/runSync are missing', async () => {
    const calls: string[] = []
    setDefaultExecutor({
      dialect: 'sqlite',
      executeQuery: async (sql: string) => {
        calls.push(sql)
        return { data: [] }
      },
    } as any)
    const n = await runSeed('users', [], { truncate: true })
    expect(n).toBe(0)
    expect(calls.some((s) => /DELETE FROM/.test(s))).toBe(true)
  })

  it('when(false) is a no-op; bank() is recorded', () => {
    setDefaultExecutor(dialectExec('sqlite') as any)
    const qb = new QueryBuilder('users').when(false, (q) => q.where('id', 1)).bank('main')
    expect(qb.toSql().sql).not.toMatch(/WHERE/)
  })

  it('whereDate / period / CI helpers / joins / aggregates per dialect', () => {
    const day = new Date('2024-06-01T12:00:00Z')
    for (const dialect of ['sqlite', 'mysql', 'postgres', 'oracle', 'mssql'] as const) {
      setDefaultExecutor(dialectExec(dialect) as any)
      const { sql } = new QueryBuilder('users')
        .distinct()
        .selectRaw('1')
        .aggregatesSelect(['id'])
        .whereDate('created_at', day)
        .whereContainsCI('email', 'Ada')
        .whereStartsWithCI('email', 'A')
        .whereEndsWithCI('email', 'com')
        .whereColumn('created_at', '<', 'updated_at')
        .whereNotExists(new QueryBuilder('posts').select(['id']))
        .whereNotBetween('n', [0, 9])
        .orWhereNull('email')
        .orWhereNotNull('n')
        .orderByMany([{ column: 'id', direction: 'DESC' }])
        .rightJoinOn('posts', 'posts.user_id', 'users.id')
        .selectCaseSum('n > 0', 'positives')
        .groupByOne('email')
        .period('created_at', '7d')
        .range('created_at', day, day)
        .toSql()
      expect(sql).toMatch(/SELECT/)
    }
    expect(() => new QueryBuilder('users').havingRaw('x > ?', [undefined])).toThrow(/undefined/)
    expect(new QueryBuilder('users').havingRaw('COUNT(*) > ?', [1]).groupBy(['id']).toSql().sql).toMatch(/HAVING/)
    setDefaultExecutor(dialectExec('sqlite') as any)
    expect(new QueryBuilder('users').period('created_at').toSql().sql).not.toMatch(/WHERE/)
    expect(new QueryBuilder('users').period('created_at', '24h').toSql().sql).toMatch(/WHERE/)
    expect(new QueryBuilder('users').period('created_at', '30d').toSql().sql).toMatch(/WHERE/)
    expect(new QueryBuilder('users').period('created_at', 'custom').toSql().sql).toMatch(/WHERE/)
  })

  it('whereDateRangeTz mysql/postgres/sqlite branches', () => {
    const start = new Date('2024-01-01T00:00:00Z')
    const end = new Date('2024-02-01T00:00:00Z')
    setDefaultExecutor(dialectExec('mysql') as any)
    expect(new QueryBuilder('events').whereDateRangeTz('start_time', start, end, 'UTC').toSql().sql).toMatch(/CONVERT_TZ/)
    setDefaultExecutor(dialectExec('postgres') as any)
    expect(new QueryBuilder('events').whereDateRangeTz('start_time', start, end, 'UTC').toSql().sql).toMatch(/AT TIME ZONE/)
    setDefaultExecutor(dialectExec('sqlite') as any)
    expect(new QueryBuilder('events').whereDateRangeTz('start_time', start, end).toSql().sql).toMatch(/BETWEEN/)
  })

  it('seed truncate prefers run() then runSync', async () => {
    const calls: string[] = []
    setDefaultExecutor({
      dialect: 'sqlite',
      executeQuery: async () => ({ data: [] }),
      run: async (sql: string) => {
        calls.push('run:' + sql)
        return { changes: 0, lastInsertRowid: 0 }
      },
    } as any)
    await runSeed('users', [], { truncate: true })
    expect(calls[0]).toMatch(/^run:/)

    calls.length = 0
    setDefaultExecutor({
      dialect: 'sqlite',
      executeQuery: async () => ({ data: [] }),
      runSync: (sql: string) => {
        calls.push('runSync:' + sql)
        return { changes: 0, lastInsertRowid: 0 }
      },
    } as any)
    await runSeed('users', [], { truncate: true })
    expect(calls[0]).toMatch(/^runSync:/)
  })
})

describe('kit + sqlite leftover helpers', () => {
  let exec: BetterSqlite3Executor

  beforeEach(() => {
    resetQueryKitConfig()
    exec = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(exec)
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, n INTEGER)')
    exec.executeQuerySync("INSERT INTO users (email, n) VALUES ('a@x.com', 1)")
  })

  afterEach(() => {
    exec.close()
    resetQueryKitConfig()
  })

  it('whereJsonContains empty object / array / scalar on sqlite', async () => {
    exec.executeQuerySync('CREATE TABLE docs (id INTEGER PRIMARY KEY, meta TEXT)')
    exec.executeQuerySync(`INSERT INTO docs (meta) VALUES ('{"a":1}'), ('[1,2]'), ('[]')`)
    expect(await new QueryBuilder('docs').whereJsonContains('meta', {}).all()).toHaveLength(3)
    expect(new QueryBuilder('docs').whereJsonContains('meta', [1, 2]).toSql().sql).toMatch(/json_each/)
    expect(await new QueryBuilder('docs').whereJsonContains('meta', 1).all()).toHaveLength(2)
  })

  it('TriggerManager async create uses run / runSync / executeQuery', async () => {
    const calls: string[] = []
    const withRun = {
      dialect: 'sqlite' as const,
      executeQuery: async (sql: string) => {
        calls.push('eq:' + sql)
        return { data: [] }
      },
      run: async (sql: string) => {
        calls.push('run:' + sql)
        return { changes: 0, lastInsertRowid: 0 }
      },
    }
    const tm = new TriggerManager()
    await tm.createTriggerAsync('trg', 'users', 'AFTER', 'INSERT', 'SELECT 1', withRun as any)
    expect(calls.some((c) => c.startsWith('run:'))).toBe(true)

    const withSync = {
      dialect: 'mysql' as const,
      executeQuery: async () => ({ data: [] }),
      runSync: (sql: string) => {
        calls.push('sync:' + sql)
        return { changes: 0, lastInsertRowid: 0 }
      },
    }
    await tm.createTriggerAsync('trg2', 'users', 'AFTER', 'DELETE', 'SELECT 1', withSync as any)
    expect(calls.some((c) => c.startsWith('sync:'))).toBe(true)

    const onlyEq = {
      dialect: 'postgres' as const,
      executeQuery: async (sql: string) => {
        calls.push('pg:' + sql)
        return { data: [] }
      },
    }
    await tm.createTriggerAsync('trg3', 'users', 'AFTER', 'UPDATE', 'SELECT 1', onlyEq as any)
    expect(calls.some((c) => c.startsWith('pg:'))).toBe(true)

    setDefaultExecutor({
      dialect: undefined,
      executeQuerySync: (sql: string) => {
        calls.push('list:' + sql)
        return { data: [{ name: 't' }] }
      },
      executeQuery: async () => ({ data: [] }),
    } as any)
    const listed = tm.listTriggers()
    expect(Array.isArray(listed)).toBe(true)
  })

  it('createQueryKit.query is an alias of table', async () => {
    const kit = createQueryKit(exec)
    const row = await kit.query('users').first<any>()
    expect(row.email).toBe('a@x.com')
    const viaTable = await table('users', exec).first<any>()
    expect(viaTable.email).toBe('a@x.com')
  })
})
