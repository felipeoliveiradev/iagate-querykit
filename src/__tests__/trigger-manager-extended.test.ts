import { describe, it, expect, beforeEach } from 'vitest'
import { setDefaultExecutor } from '../config'
import { TriggerManager } from '../trigger-manager'

class ExecMock {
  public dialect: 'sqlite' = 'sqlite'
  private _triggers = new Set<string>()

  executeQuerySync(sql: string, bindings: any[] = []) {
    if (/SELECT name FROM sqlite_master WHERE type='trigger'/.test(sql)) {
      const data = Array.from(this._triggers).map(name => ({ name }))
      return { data }
    }
    return { data: [] }
  }
  async executeQuery(sql: string, bindings: any[] = []) { return this.executeQuerySync(sql, bindings) }

  runSync(sql: string, bindings: any[] = []) {
    const createMatch = /CREATE TRIGGER IF NOT EXISTS\s+(\S+)/i.exec(sql)
    if (createMatch) { this._triggers.add(createMatch[1]); return { changes: 1, lastInsertRowid: 1 } }
    const dropMatch = /DROP TRIGGER IF EXISTS\s+(\S+)/i.exec(sql)
    if (dropMatch) { this._triggers.delete(dropMatch[1]); return { changes: 1, lastInsertRowid: 0 } }
    return { changes: 0, lastInsertRowid: 0 }
  }
}

describe('TriggerManager extended API', () => {
  beforeEach(() => { setDefaultExecutor(new ExecMock() as any) })

  it('listDetailed separates bank and state triggers', async () => {
    const tm = new TriggerManager()
    tm.create('only_state', { when: 'AFTER', action: 'INSERT', table: 'users', body: async () => {}, state: 'state' })
    tm.create('only_bank', { when: 'AFTER', action: 'INSERT', table: 'users', body: 'SELECT 1;' })
    const detailed = await tm.listDetailedAsync()
    expect(detailed.bank_triggers).toContain('only_bank__AFTER__INSERT__users')
    expect(detailed.state_triggers).toContain('only_state')
    tm.drop('only_state'); tm.drop('only_bank')
  })

  it('dropAsync removes both bank and state triggers', async () => {
    const tm = new TriggerManager()
    tm.create('d1', { when: 'AFTER', action: 'INSERT', table: 'users', body: 'SELECT 1;' })
    tm.create('d2', { when: 'AFTER', action: 'INSERT', table: 'users', body: async ()=>{}, state: 'state' })
    await tm.dropAsync('d1')
    await tm.dropAsync('d2')
    const detailed = await tm.listDetailedAsync()
    expect(detailed.bank_triggers.find(n => n.includes('d1'))).toBeUndefined()
    expect(detailed.state_triggers).not.toContain('d2')
  })

  it('dropAll removes all triggers', async () => {
    const tm = new TriggerManager()
    tm.create('a', { when: 'AFTER', action: 'INSERT', table: 'users', body: 'SELECT 1;' })
    tm.create('b', { when: 'AFTER', action: 'UPDATE', table: 'users', body: async ()=>{}, state: 'state' })
    tm.dropAll()
    const detailed = tm.listDetailed()
    expect(detailed.bank_triggers.length).toBe(0)
    expect(detailed.state_triggers.length).toBe(0)
  })

  it('mixed body (SQL + callback) creates bank trigger and semantic listener', async () => {
    const tm = new TriggerManager()
    tm.create('mix', { when: 'AFTER', action: 'DELETE', table: 'users', body: ['SELECT 1;', async ()=>{}] })
    const detailed = await tm.listDetailedAsync()
    expect(detailed.bank_triggers).toContain('mix__AFTER__DELETE__users')
    expect(detailed.state_triggers).toContain('mix')
    tm.drop('mix')
  })

  it('READ action never creates bank trigger even with SQL body', async () => {
    const tm = new TriggerManager()
    tm.create('read', { when: 'AFTER', action: 'READ', table: 'users', body: 'SELECT 1;' })
    const detailed = tm.listDetailed()
    expect(detailed.bank_triggers.find(n => n.includes('read'))).toBeUndefined()
    expect(detailed.state_triggers).toContain('read')
    tm.drop('read')
  })

  it('listDetailed (sync) returns current state', () => {
    const tm = new TriggerManager()
    tm.create('sync1', { when: 'AFTER', action: 'INSERT', table: 'users', body: 'SELECT 1;' })
    const detailed = tm.listDetailed()
    expect(Array.isArray(detailed.bank_triggers)).toBe(true)
    expect(Array.isArray(detailed.state_triggers)).toBe(true)
    tm.drop('sync1')
  })
}) 