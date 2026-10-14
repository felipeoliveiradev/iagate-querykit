import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setDefaultExecutor, resetQueryKitConfig, setRelations } from '../config'
import { QueryBuilder } from '../query-builder'
import { runSeed, Seed } from '../seed'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'

describe('runSeed', () => {
  let exec: BetterSqlite3Executor

  beforeEach(() => {
    resetQueryKitConfig()
    exec = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(exec)
    exec.executeQuerySync(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, active INTEGER)',
    )
  })

  afterEach(() => {
    exec.close()
    resetQueryKitConfig()
  })

  it('inserts array rows', async () => {
    const n = await runSeed('users', [{ email: 'seed@ex.com', active: 1 }], { truncate: true })
    expect(n).toBe(1)
    expect(await new QueryBuilder('users').all()).toHaveLength(1)
  })

  it('supports class Seed', async () => {
    class S extends Seed<{ email: string; active: number }> {
      async run() {
        return [{ email: 'x@ex.com', active: 1 }]
      }
    }
    const n = await runSeed('users', new S())
    expect(n).toBe(1)
  })

  it('returns 0 for empty data and still truncates when asked', async () => {
    await runSeed('users', [{ email: 'keep@ex.com', active: 1 }])
    const n = await runSeed('users', [], { truncate: true })
    expect(n).toBe(0)
    expect(await new QueryBuilder('users').all()).toEqual([])
  })

  it('ignoreDuplicates skips existing uniqueBy rows', async () => {
    await runSeed('users', [{ email: 'a@ex.com', active: 1 }])
    const n = await runSeed(
      'users',
      [
        { email: 'a@ex.com', active: 0 },
        { email: 'b@ex.com', active: 1 },
      ],
      { uniqueBy: ['email'], ignoreDuplicates: true },
    )
    expect(n).toBe(2)
    const rows = await new QueryBuilder('users').orderBy('id').all<any>()
    expect(rows).toHaveLength(2)
    expect(rows[0].active).toBe(1)
    expect(rows[1].email).toBe('b@ex.com')
  })

  it('upsert updates existing uniqueBy rows', async () => {
    await runSeed('users', [{ email: 'a@ex.com', active: 1 }])
    await runSeed(
      'users',
      [{ email: 'a@ex.com', active: 0 }],
      { uniqueBy: ['email'], upsert: true },
    )
    const row = await new QueryBuilder('users').where('email', 'a@ex.com').first<any>()
    expect(row.active).toBe(0)
  })

  it('throws when no executor is configured', async () => {
    resetQueryKitConfig()
    await expect(runSeed('users', [{ email: 'x@ex.com' }])).rejects.toThrow(/No executor/)
  })
})

describe('relationship() without a registry', () => {
  let exec: BetterSqlite3Executor

  beforeEach(() => {
    resetQueryKitConfig()
    exec = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(exec)
    exec.executeQuerySync('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)')
    exec.executeQuerySync("INSERT INTO users (email) VALUES ('a@ex.com')")
  })

  afterEach(() => {
    exec.close()
    resetQueryKitConfig()
  })

  it('returns rows unchanged when setRelations was never called', async () => {
    const out = await new QueryBuilder('users').relationship().all<any>()
    expect(out).toHaveLength(1)
    expect(out[0].email).toBe('a@ex.com')
    expect(out[0].posts).toBeUndefined()
  })

  it('returns rows unchanged when the table has no defs', async () => {
    setRelations({ posts: [{ name: 'user', kind: 'belongsTo', table: 'users', foreignKey: 'user_id' }] })
    const out = await new QueryBuilder('users').relationship().all<any>()
    expect(out[0].posts).toBeUndefined()
  })
})
