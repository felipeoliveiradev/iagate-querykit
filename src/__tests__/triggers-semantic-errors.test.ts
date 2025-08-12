import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setDefaultExecutor } from '../config'
import { TriggerManager } from '../trigger-manager'
import { QueryBuilder } from '../query-builder'

class ExecMock {
  runSync(sql: string, bindings: any[] = []) { return { changes: 1, lastInsertRowid: 1 } }
  executeQuery(sql: string, bindings: any[] = []) { return Promise.resolve({ data: [] }) }
  executeQuerySync(sql: string, bindings: any[] = []) { return { data: [] } }
}

describe('Semantic triggers error cases', () => {
  beforeEach(() => setDefaultExecutor(new ExecMock() as any))

  it('parallel bodies continues if one throws (others still run)', async () => {
    const tm = new TriggerManager()
    const a = vi.fn(); const b = vi.fn(() => { throw new Error('boom') }); const c = vi.fn()
    tm.create('p', { when: 'AFTER', action: 'INSERT', table: 't', body: { parallel: [() => a(), async () => { try { b(); } catch {} }, () => c()] } })
    await new QueryBuilder('t').insert({ x: 1 }).make()
    expect(a).toHaveBeenCalled(); expect(c).toHaveBeenCalled()
    tm.drop('p')
  })

  it('except filtering removes READ from *', async () => {
    const tm = new TriggerManager()
    const fn = vi.fn()
    tm.create('e', { when: 'AFTER', action: '*', except: ['READ'], table: 't', body: fn })
    await new QueryBuilder('t').insert({ x: 1 }).make()
    await new QueryBuilder('t').all()
    expect(fn).toHaveBeenCalledTimes(1)
    tm.drop('e')
  })
}) 