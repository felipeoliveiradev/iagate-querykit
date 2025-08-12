import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setDefaultExecutor } from '../config'
import { TriggerManager } from '../trigger-manager'
import { QueryBuilder } from '../query-builder'

class ExecMock {
  rows: any[] = []
  executeQuerySync(sql: string, bindings: any[] = []) { return { data: this.rows.slice() } }
  executeQuery(sql: string, bindings: any[] = []) { return Promise.resolve({ data: this.rows.slice() }) }
  runSync(sql: string, bindings: any[] = []) { return { changes: 1, lastInsertRowid: 1 } }
}

describe('Semantic triggers advanced', () => {
  let exec: ExecMock
  beforeEach(() => { exec = new ExecMock(); setDefaultExecutor(exec as any) })

  it('array body runs sequentially and function receives context', async () => {
    const tm = new TriggerManager()
    const calls: any[] = []
    tm.create('seq', { when: 'AFTER', action: 'INSERT', table: 'users', body: [
      (ctx) => calls.push(`A:${ctx.action}:${ctx.table}`),
      (ctx) => calls.push(`B:${ctx.action}:${ctx.table}`)
    ] })
    await new QueryBuilder('users').insert({ id: 1 }).make()
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toEqual(['A:INSERT:users','B:INSERT:users'])
    tm.drop('seq')
  })

  it('parallel body runs concurrently', async () => {
    const tm = new TriggerManager()
    const a = vi.fn(); const b = vi.fn();
    tm.create('par', { when: 'AFTER', action: 'UPDATE', table: 'users', body: { parallel: [() => a(), () => b()] } })
    await new QueryBuilder('users').where('id','=',1).update({ x: 1 }).make()
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
    tm.drop('par')
  })

  it('wildcard with except is honored', async () => {
    const tm = new TriggerManager()
    const handler = vi.fn()
    tm.create('wc', { when: 'AFTER', action: '*', except: ['READ'], table: 'users', body: handler })
    await new QueryBuilder('users').insert({ id: 1 }).make()
    exec.rows = [{ id: 1 }]
    await new QueryBuilder('users').select(['id']).all()
    expect(handler).toHaveBeenCalledTimes(1)
    tm.drop('wc')
  })

  it('READ triggers receive rows', async () => {
    const tm = new TriggerManager()
    const seen: any[] = []
    tm.create('r', { when: 'AFTER', action: 'READ', table: 'users', body: (ctx) => { seen.push(ctx.rows?.length) } })
    exec.rows = [{ id: 1 }, { id: 2 }]
    await new QueryBuilder('users').select(['id']).all()
    expect(seen[0]).toBe(2)
    tm.drop('r')
  })

  it('passes where context (sql/bindings) on UPDATE and DELETE', async () => {
    const tm = new TriggerManager()
    const updateCtx: any[] = []
    const deleteCtx: any[] = []
    tm.create('ctx_upd', { when: 'AFTER', action: 'UPDATE', table: 'users', body: (ctx) => { updateCtx.push(ctx.where) } })
    tm.create('ctx_del', { when: 'AFTER', action: 'DELETE', table: 'users', body: (ctx) => { deleteCtx.push(ctx.where) } })
    await new QueryBuilder('users').where('id','=',1).update({ a: 1 }).make()
    await new QueryBuilder('users').where('id','=',2).delete().make()
    expect(updateCtx[0]?.sql).toMatch(/id = \?/)
    expect(updateCtx[0]?.bindings).toEqual(expect.arrayContaining([1]))
    expect(deleteCtx[0]?.sql).toMatch(/id = \?/)
    expect(deleteCtx[0]?.bindings).toEqual(expect.arrayContaining([2]))
  })
}) 