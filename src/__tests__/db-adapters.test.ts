import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setDefaultExecutor } from '../config'
import { QueryBuilder } from '../query-builder'

// Provide global mocks for adapters to detect
beforeEach(() => {
  (globalThis as any).__vitest_mocks__ = {
    mysql2: {
      createPool: () => ({
        execute: async (sql: string, bindings: any[]) => {
          if (/^\s*insert/i.test(sql)) return [[], { affectedRows: 1, insertId: 123 }]
          if (/^\s*update/i.test(sql)) return [[], { affectedRows: 1 }]
          if (/^\s*delete/i.test(sql)) return [[], { affectedRows: 1 }]
          return [[{ id: 1 }], {}]
        }
      })
    },
    pg: {
      Pool: function(this: any) {
        return {
          query: async ({ text, values }: any) => {
            if (/^\s*insert/i.test(text)) return { rows: [], rowCount: 1 }
            if (/^\s*update|^\s*delete/i.test(text)) return { rows: [], rowCount: 1 }
            return { rows: [{ id: 2 }], rowCount: 1 }
          }
        }
      }
    },
    oracledb: {
      OUT_FORMAT_OBJECT: 1,
      createPool: async () => ({
        getConnection: async () => ({
          execute: async (sql: string, bindings: any[]) => {
            if (/^\s*insert/i.test(sql)) return { rows: [], rowsAffected: 1, lastRowid: 456 }
            if (/^\s*update|^\s*delete/i.test(sql)) return { rows: [], rowsAffected: 1 }
            return { rows: [{ ID: 3 }], rowsAffected: 0 }
          },
          close: async () => {}
        })
      })
    },
    mssql: {
      ConnectionPool: function(this: any, _cfg: any) {
        return {
          connect: async () => ({
            request: () => ({
              input: (_name: string, _val: any) => ({
                input: (_n2: string, _v2: any) => ({
                  query: async (sql: string) => {
                    if (/^\s*insert/i.test(sql)) return { recordset: [], rowsAffected: [1] }
                    if (/^\s*update|^\s*delete/i.test(sql)) return { recordset: [], rowsAffected: [1] }
                    return { recordset: [{ id: 4 }], rowsAffected: [0] }
                  }
                })
              }),
              query: async (sql: string) => ({ recordset: [], rowsAffected: [1] })
            })
          })
        }
      }
    }
  }
})

import { MysqlExecutor } from '../adapters/mysql'
import { PostgresExecutor } from '../adapters/postgresql'
import { OracleExecutor } from '../adapters/oracle'
import { SqlServerExecutor } from '../adapters/sqlserver'

describe('Database adapters', () => {
  it('mysql select/insert/update/delete with where bindings', async () => {
    const exec = new MysqlExecutor({ user: 'u' })
    setDefaultExecutor(exec as any)
    const rows = await new QueryBuilder('users')
      .whereIn('id', [1, 2, 3])
      .whereBetween('created_at', ['2025-01-01', '2025-12-31'] as any)
      .whereNull('deleted_at')
      .all()
    expect(Array.isArray(rows)).toBe(true)
    const ins = await new QueryBuilder('users').insert({ email: 'a@b.com' }).make()
    expect(ins.changes).toBe(1)
    const upd = await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
    expect(upd.changes).toBe(1)
    const del = await new QueryBuilder('users').where('id', '=', 2).delete().make()
    expect(del.changes).toBe(1)
  })

  it('postgres select + where bindings and writes', async () => {
    const exec = new PostgresExecutor({})
    setDefaultExecutor(exec as any)
    const rows = await new QueryBuilder('users')
      .whereIn('id', [1, 2])
      .whereBetween('created_at', ['2025-01-01', '2025-12-31'] as any)
      .whereNull('deleted_at')
      .all()
    expect(rows[0].id).toBe(2)
    const ins = await new QueryBuilder('users').insert({ email: 'b@b.com' }).make()
    expect(ins.changes).toBe(1)
    const upd = await new QueryBuilder('users').where('id', '=', 1).update({ active: 1 }).make()
    expect(upd.changes).toBe(1)
    const del = await new QueryBuilder('users').where('id', '=', 3).delete().make()
    expect(del.changes).toBe(1)
  })

  it('oracle select/write with where bindings', async () => {
    const exec = new OracleExecutor({ user: 'u', password: 'p', connectString: 'x' })
    setDefaultExecutor(exec as any)
    const rows = await new QueryBuilder('users')
      .whereIn('id', [7, 8])
      .whereNull('deleted_at')
      .all()
    expect(Array.isArray(rows)).toBe(true)
    const res = await new QueryBuilder('users').insert({ email: 'c@b.com' }).make()
    expect(res.changes).toBe(1)
    const upd = await new QueryBuilder('users').where('id', '=', 6).update({ active: 1 }).make()
    expect(upd.changes).toBe(1)
    const del = await new QueryBuilder('users').where('id', '=', 9).delete().make()
    expect(del.changes).toBe(1)
  })

  it('sqlserver select/write with where bindings', async () => {
    const exec = new SqlServerExecutor({ user: 'sa', password: 'x', server: 'localhost' })
    setDefaultExecutor(exec as any)
    const rows = await new QueryBuilder('users')
      .whereIn('id', [10, 11])
      .whereBetween('created_at', ['2025-01-01', '2025-12-31'] as any)
      .all()
    expect(Array.isArray(rows)).toBe(true)
    const res = await new QueryBuilder('users').insert({ email: 'd@b.com' }).make()
    expect(res.changes).toBe(1)
    const upd = await new QueryBuilder('users').where('id', '=', 5).update({ active: 1 }).make()
    expect(upd.changes).toBe(1)
    const del = await new QueryBuilder('users').where('id', '=', 6).delete().make()
    expect(del.changes).toBe(1)
  })
})

// Additional transaction sequence tests (merged)

describe('Adapters transaction sequences (mocked)', () => {
  class TxExecMock {
    public calls: string[] = []
    async executeQuery(sql: string, bindings: any[] = []) {
      this.calls.push(sql.trim().split(/\s+/)[0].toUpperCase())
      return { data: [] }
    }
    runSync(sql: string, bindings: any[] = []) { this.calls.push(sql.trim().split(/\s+/)[0].toUpperCase()); return { changes: 1, lastInsertRowid: 1 } }
  }
  let exec: TxExecMock
  beforeEach(() => { exec = new TxExecMock(); setDefaultExecutor(exec as any) })

  it('basic BEGIN/COMMIT and payload', async () => {
    await exec.executeQuery('BEGIN', [])
    await new QueryBuilder('t').insert({ a: 1 }).make()
    await exec.executeQuery('COMMIT', [])
    expect(exec.calls).toEqual(['BEGIN','INSERT','COMMIT'])
  })

  it('with SAVEPOINT/ROLLBACK TO', async () => {
    await exec.executeQuery('BEGIN', [])
    await exec.executeQuery('SAVEPOINT sp1', [])
    await exec.executeQuery('ROLLBACK TO SAVEPOINT sp1', [])
    await exec.executeQuery('COMMIT', [])
    expect(exec.calls).toEqual(['BEGIN','SAVEPOINT','ROLLBACK','COMMIT'])
  })
});

describe('BetterSqlite3Executor', () => {
  it('executeQuerySync select and write', async () => {
    const prepared: any = { all: vi.fn(() => [{ id: 1 }]), run: vi.fn(() => ({ changes: 1, lastInsertRowid: 99 })) }
    ;(globalThis as any).__vitest_mocks__ = { ...(globalThis as any).__vitest_mocks__, betterSqlite3: function(db: string) { return { prepare: vi.fn(() => prepared) } } }
    const { BetterSqlite3Executor } = await import('../adapters/better-sqlite3')
    const exec = new BetterSqlite3Executor(':memory:') as any
    const sel = exec.executeQuerySync('select * from t where id = ?', [1])
    expect(sel.data[0].id).toBe(1)
    const wr = exec.executeQuerySync('update t set a = ? where id = ?', [2, 1])
    expect(wr.affectedRows).toBe(1)
    expect(wr.lastInsertId).toBe(99)
  })

  it('executeQuery (async) wraps sync path and returns same shape', async () => {
    const prepared: any = { all: vi.fn(() => [{ id: 2 }]), run: vi.fn(() => ({ changes: 3, lastInsertRowid: 7 })) }
    ;(globalThis as any).__vitest_mocks__ = { ...(globalThis as any).__vitest_mocks__, betterSqlite3: function(db: string) { return { prepare: vi.fn(() => prepared) } } }
    const { BetterSqlite3Executor } = await import('../adapters/better-sqlite3')
    const exec = new BetterSqlite3Executor(':memory:') as any
    const sel = await exec.executeQuery('select * from t', [])
    expect(sel.data[0].id).toBe(2)
    const wr = await exec.executeQuery('delete from t where id = ?', [1])
    expect(wr.affectedRows).toBe(3)
    expect(wr.lastInsertId).toBe(7)
  })

  it('runSync returns changes and lastInsertRowid', async () => {
    const prepared: any = { run: vi.fn(() => ({ changes: 5, lastInsertRowid: 11 })), all: vi.fn() }
    ;(globalThis as any).__vitest_mocks__ = { ...(globalThis as any).__vitest_mocks__, betterSqlite3: function(db: string) { return { prepare: vi.fn(() => prepared) } } }
    const { BetterSqlite3Executor } = await import('../adapters/better-sqlite3')
    const exec = new BetterSqlite3Executor(':memory:') as any
    const info = exec.runSync('update t set a=1', [])
    expect(info.changes).toBe(5)
    expect(info.lastInsertRowid).toBe(11)
  })
}) 