import { describe, it, expect, beforeEach } from 'vitest'
import { setDefaultExecutor } from '../config'
import { QueryBuilder } from '../query-builder'
import { parallel } from '../parallel-query'

class ExecMock {
  calls: string[] = []
  executeQuery(sql: string, bindings: any[]) { this.calls.push('all'); return Promise.resolve({ data: [] }) }
  runSync(sql: string, bindings: any[]) { this.calls.push('make'); return { changes: 1, lastInsertRowid: 1 } }
}

describe('parallel()', () => {
  let exec: ExecMock
  beforeEach(() => { exec = new ExecMock(); setDefaultExecutor(exec as any) })

  it('runs reads with all() and writes with runSync()', async () => {
    const q1 = new QueryBuilder('t').select(['id'])
    const q2 = new QueryBuilder('t').insert({ a: 1 })
    const res = await parallel(q1 as any, q2 as any)
    expect(Array.isArray(res)).toBe(true)
    expect(exec.calls).toEqual(['all','make'])
  })
}) 