import { describe, it, expectTypeOf, expect } from 'vitest'
import {
  QueryBuilder,
  createQueryKit,
  BetterSqlite3Executor,
  migrateUp,
  attachRelations,
  BindError,
  InsertError,
  QueryKitError,
  fts5CreateSql,
  maxBindParams,
  type QueryKit,
  type WriteResult,
  type DatabaseExecutor,
  type SqlDialect,
  type MigrationSpec,
} from '../index.js'

type User = { id: number; email: string; active: boolean }

describe('public API type-level contracts', () => {
  it('QueryBuilder write/read signatures', () => {
    const qb = new QueryBuilder<User>('users')
    expectTypeOf(qb.where).toBeFunction()
    expectTypeOf(qb.insert).parameter(0).toMatchTypeOf<Partial<User> | Partial<User>[]>()
    expectTypeOf(qb.update).parameter(0).toMatchTypeOf<Partial<User>>()
    expectTypeOf(qb.maxBindings).returns.toEqualTypeOf<QueryBuilder<User>>()
    expectTypeOf(qb.whereFullText).toBeFunction()
    expectTypeOf(qb.all<User>).returns.resolves.toEqualTypeOf<User[]>()
    expectTypeOf(qb.get<User>).returns.resolves.toEqualTypeOf<User | undefined>()
    expectTypeOf(qb.first<User>).returns.resolves.toEqualTypeOf<User | undefined>()
    expectTypeOf(qb.make).returns.resolves.toEqualTypeOf<WriteResult>()
    expectTypeOf(qb.toSql).returns.toMatchTypeOf<{ sql: string; bindings: unknown[] }>()
  })

  it('createQueryKit binds table/transaction/close', () => {
    expectTypeOf(createQueryKit).parameter(0).toMatchTypeOf<DatabaseExecutor>()
    expectTypeOf(createQueryKit).returns.toEqualTypeOf<QueryKit>()
    type Kit = ReturnType<typeof createQueryKit>
    expectTypeOf<Kit['table']>().returns.toEqualTypeOf<QueryBuilder<any>>()
    expectTypeOf<Kit['query']>().returns.toEqualTypeOf<QueryBuilder<any>>()
    expectTypeOf<Kit['close']>().returns.toMatchTypeOf<void | Promise<void>>()
    expectTypeOf<Kit['executor']['dialect']>().toEqualTypeOf<SqlDialect>()
  })

  it('adapter and helper exports', () => {
    expectTypeOf<BetterSqlite3Executor['dialect']>().toEqualTypeOf<'sqlite'>()
    expectTypeOf(maxBindParams('mssql')).toEqualTypeOf<number>()
    expectTypeOf(fts5CreateSql({ name: 'd', columns: ['t'] })).toEqualTypeOf<string>()
    expectTypeOf<MigrationSpec['id']>().toEqualTypeOf<string>()
    expectTypeOf(migrateUp).toBeFunction()
    expectTypeOf(attachRelations).toBeFunction()
    expectTypeOf<InstanceType<typeof BindError>>().toMatchTypeOf<QueryKitError>()
    expectTypeOf<InstanceType<typeof InsertError>>().toMatchTypeOf<QueryKitError>()
  })

  it('runtime smoke so the file is not type-only', () => {
    expect(maxBindParams('sqlite')).toBe(999)
  })
})
