import { describe, it, expect, beforeEach } from 'vitest'
import { MysqlExecutor } from '../adapters/mysql.js'
import { PostgresExecutor } from '../adapters/postgresql.js'
import { OracleExecutor } from '../adapters/oracle.js'
import { SqlServerExecutor } from '../adapters/sqlserver.js'
import { asWrite, loadOptionalPeer } from '../adapters/shared.js'

describe('adapter transaction + close (mocked drivers)', () => {
  beforeEach(() => {
    delete (globalThis as any).__vitest_mocks__
  })

  it('postgres transaction commits, rolls back, releases, and close() ends an owned pool', async () => {
    const calls: string[] = []
    const client = {
      query: async (arg: any) => {
        const text = typeof arg === 'string' ? arg : arg.text
        calls.push(text)
        if (/^BEGIN|COMMIT|ROLLBACK$/i.test(text)) return { rows: [], rowCount: 0 }
        return { rows: [{ id: 9 }], rowCount: 1 }
      },
      release: () => {
        calls.push('RELEASE')
      },
    }
    const pool = {
      connect: async () => client,
      query: async (arg: any) => client.query(arg),
      end: async () => {
        calls.push('END')
      },
    }
    ;(globalThis as any).__vitest_mocks__ = { pg: { Pool: function () { return pool } } }
    const exec = new PostgresExecutor({ host: '127.0.0.1' })
    const ok = await exec.transaction(async (tx) => {
      await tx.run!('SELECT * FROM t WHERE id = ?', [1])
      const rows = await tx.executeQuery('SELECT * FROM t WHERE id = ?', [1])
      return rows.data[0].id
    })
    expect(ok).toBe(9)
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('COMMIT')
    expect(calls).toContain('RELEASE')

    await expect(
      exec.transaction(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(calls).toContain('ROLLBACK')

    await exec.close()
    expect(calls).toContain('END')

    const borrowed = new PostgresExecutor({ pool })
    await borrowed.executeQuery('SELECT 1', [])
    await borrowed.close()
    expect(calls.filter((c) => c === 'END')).toHaveLength(1)
  })

  it('mysql transaction commits, rolls back, releases, and close() ends an owned pool', async () => {
    const calls: string[] = []
    const conn = {
      execute: async (sql: string) => {
        calls.push(sql)
        return [[{ id: 3 }], { affectedRows: 1, insertId: 3 }]
      },
      beginTransaction: async () => {
        calls.push('BEGIN')
      },
      commit: async () => {
        calls.push('COMMIT')
      },
      rollback: async () => {
        calls.push('ROLLBACK')
      },
      release: () => {
        calls.push('RELEASE')
      },
    }
    const pool = {
      execute: async (sql: string) => conn.execute(sql),
      getConnection: async () => conn,
      end: async () => {
        calls.push('END')
      },
    }
    ;(globalThis as any).__vitest_mocks__ = { mysql2: { createPool: () => pool } }
    const exec = new MysqlExecutor({ host: '127.0.0.1', user: 'u' })
    const n = await exec.transaction(async (tx) => {
      await tx.run!('SELECT 1', [])
      return (await tx.executeQuery('SELECT 1', [])).data[0].id
    })
    expect(n).toBe(3)
    expect(calls).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT', 'RELEASE']))

    await expect(
      exec.transaction(async () => {
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    expect(calls).toContain('ROLLBACK')
    await exec.close()
    expect(calls).toContain('END')

    const borrowedMysql = new MysqlExecutor({ pool })
    await borrowedMysql.executeQuery('SELECT 1', [])
    await borrowedMysql.close()
  })

  it('oracle transaction commits / rolls back and close() closes an owned pool', async () => {
    const calls: string[] = []
    const conn = {
      execute: async (sql: string) => {
        calls.push(sql)
        return { rows: [{ ID: 4 }], rowsAffected: 1, lastRowid: 4 }
      },
      commit: async () => {
        calls.push('COMMIT')
      },
      rollback: async () => {
        calls.push('ROLLBACK')
      },
      close: async () => {
        calls.push('CLOSE_CONN')
      },
    }
    const pool = {
      getConnection: async () => conn,
      close: async () => {
        calls.push('CLOSE_POOL')
      },
    }
    ;(globalThis as any).__vitest_mocks__ = {
      oracledb: { OUT_FORMAT_OBJECT: 1, createPool: async () => pool },
    }
    const exec = new OracleExecutor({ user: 'u', password: 'p', connectString: 'x' })
    const id = await exec.transaction(async (tx) => (await tx.executeQuery('SELECT 1 FROM dual', [])).data[0].ID)
    expect(id).toBe(4)
    expect(calls).toEqual(expect.arrayContaining(['COMMIT', 'CLOSE_CONN']))

    await expect(
      exec.transaction(async () => {
        throw new Error('ora')
      }),
    ).rejects.toThrow('ora')
    expect(calls).toContain('ROLLBACK')
    await exec.close()
    expect(calls).toContain('CLOSE_POOL')

    const borrowed = new OracleExecutor({ pool })
    await borrowed.close()
    expect(calls.filter((c) => c === 'CLOSE_POOL')).toHaveLength(1)
  })

  it('sqlserver transaction commits / rolls back and close() closes an owned pool', async () => {
    const calls: string[] = []
    const request = {
      input() {
        return this
      },
      async query(sql: string) {
        calls.push(sql)
        return { recordset: [{ id: 5 }], rowsAffected: [1] }
      },
    }
    const transaction = {
      begin: async () => {
        calls.push('BEGIN')
      },
      commit: async () => {
        calls.push('COMMIT')
      },
      rollback: async () => {
        calls.push('ROLLBACK')
      },
    }
    const pool = {
      request: () => request,
      close: async () => {
        calls.push('CLOSE_POOL')
      },
    }
    ;(globalThis as any).__vitest_mocks__ = {
      mssql: {
        ConnectionPool: function () {
          return { connect: async () => pool }
        },
        Transaction: function () {
          return transaction
        },
        Request: function () {
          return request
        },
      },
    }
    const exec = new SqlServerExecutor({ user: 'sa', password: 'x', server: '127.0.0.1' })
    const id = await exec.transaction(async (tx) => (await tx.executeQuery('SELECT 1', [])).data[0].id)
    expect(id).toBe(5)
    expect(calls).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']))

    await expect(
      exec.transaction(async () => {
        throw new Error('ms')
      }),
    ).rejects.toThrow('ms')
    expect(calls).toContain('ROLLBACK')
    await exec.close()
    expect(calls).toContain('CLOSE_POOL')
  })

  it('shared helpers: asWrite and missing peer', () => {
    expect(asWrite({ data: [], affectedRows: 2, lastInsertId: 9 })).toEqual({
      changes: 2,
      lastInsertRowid: 9,
    })
    expect(asWrite({ data: [] })).toEqual({ changes: 0, lastInsertRowid: 0 })
    expect(() => loadOptionalPeer('definitely-not-installed-qk', 'missing')).toThrow(/required/)
  })
})
