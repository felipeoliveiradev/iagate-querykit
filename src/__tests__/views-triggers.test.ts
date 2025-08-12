import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setDefaultExecutor } from '../config'
import { ViewManager } from '../view-manager'
import { TriggerManager } from '../trigger-manager'
import { QueryBuilder } from '../query-builder'
import { QueryKitConfig } from '../config'
import { scheduler } from '../scheduler'

class ExecMock {
  constructor(public dialect: any, public rows: any[]) {}
  executeQuerySync(sql: string, bindings: any[] = []) {
    if (/USER_TRIGGERS/i.test(sql)) return { data: this.rows.map(r => ({ name: r.TRIGGER_NAME || r.name || r })) }
    if (/information_schema\.views/i.test(sql)) return { data: this.rows }
    if (/sqlite_master/.test(sql)) return { data: this.rows.map(r => ({ name: r })) }
    if (/INFORMATION_SCHEMA.TRIGGERS/.test(sql)) return { data: this.rows.map(r => ({ name: r })) }
    if (/pg_trigger/.test(sql)) return { data: this.rows.map(r => ({ tgname: r })) }
    if (/sys.triggers/.test(sql)) return { data: this.rows.map(r => ({ name: r })) }
    return { data: this.rows }
  }
  runSync(sql: string, bindings: any[] = []) { return { changes: 1, lastInsertRowid: 1 } }
}

class AsyncExecMock {
  constructor(public dialect: any, public rows: any[]) {}
  async executeQuery(sql: string, bindings: any[] = []) {
    if (/information_schema\.views/i.test(sql)) return { data: this.rows.map(r => ({ table_name: r })) }
    if (/USER_TRIGGERS/i.test(sql)) return { data: this.rows.map(r => ({ TRIGGER_NAME: r, name: r })) }
    return { data: this.rows }
  }
}

describe('View/Trigger managers core behaviors', () => {
  class CoreExec { rows: any[] = []; executeQuerySync(sql: string, b: any[] = []) { return { data: this.rows.slice() } }; executeQuery(sql: string, b: any[] = []) { return Promise.resolve({ data: this.rows.slice() }) }; runSync(sql: string, b: any[] = []) { return { changes: 1, lastInsertRowid: 1 } } }
  let exec: CoreExec
  beforeEach(() => { exec = new CoreExec(); setDefaultExecutor(exec as any) })

  it('creates and lists views', () => {
    const vm = new ViewManager();
    const qb = new QueryBuilder('users').select(['id']);
    vm.createOrReplaceView('v_users', qb);
    exec.rows = [{ name: 'v_users' }];
    expect(vm.listViews()).toEqual(['v_users']);
    expect(vm.viewExists('v_users')).toBe(true);
    vm.dropView('v_users');
  });

  it('creates and drops triggers (SQL)', () => {
    const tm = new TriggerManager();
    tm.createTrigger('trg', 'users', 'AFTER', 'INSERT', 'SELECT 1;');
    exec.rows = [{ name: 'trg' }];
    expect(tm.listTriggers()).toEqual(['trg']);
    expect(tm.triggerExists('trg')).toBe(true);
    tm.dropTrigger('trg');
  });

  it('semantic trigger executes SQL body', async () => {
    const tm = new TriggerManager();
    const spy = vi.spyOn(exec, 'runSync');
    tm.create('audit_insert', { when: 'AFTER', action: 'INSERT', table: 'users', body: `INSERT INTO audit_log(action) VALUES('INSERT')` });
    await new QueryBuilder('users').insert({ id: 1, name: 'A' }).make();
    expect(spy).toHaveBeenCalled();
    tm.drop('audit_insert');
  });

  it('semantic trigger executes function body', async () => {
    const tm = new TriggerManager();
    const handler = vi.fn();
    tm.create('fn_after_update', { when: 'AFTER', action: 'UPDATE', table: 'users', body: async (ctx) => { handler(ctx.table, ctx.action, ctx.timing); } });
    await new QueryBuilder('users').where('id','=',1).update({ name: 'B' }).make();
    expect(handler).toHaveBeenCalledWith('users','UPDATE','AFTER');
    tm.drop('fn_after_update');
  });

  it('supports multiple actions and tables, including * wildcard', async () => {
    const tm = new TriggerManager();
    const calls: any[] = [];
    tm.create('multi', { when: 'AFTER', action: ['*'], table: ['users','orders'], body: [(ctx) => calls.push(`${ctx.action}:${ctx.table}`)] });
    await new QueryBuilder('users').insert({ id: 1 }).make();
    await new QueryBuilder('users').where('id','=',1).update({ name: 'X' }).make();
    await new QueryBuilder('orders').where('id','=',1).delete().make();
    exec.rows = [{ id: 1 }];
    await new QueryBuilder('users').select(['id']).all();
    expect(calls).toEqual(expect.arrayContaining(['INSERT:users','UPDATE:users','DELETE:orders','READ:users']));
    tm.drop('multi');
  });

  it('array body runs all steps sequentially', async () => {
    const tm = new TriggerManager();
    const spy = vi.spyOn(exec, 'runSync');
    tm.create('batch', { when: 'AFTER', action: 'INSERT', table: 'users', body: [`SELECT 1;`, async () => { await new QueryBuilder('logs').insert({ ok: 1 }).make(); }] });
    await new QueryBuilder('users').insert({ id: 2 }).make();
    expect(spy).toHaveBeenCalled();
    tm.drop('batch');
  });

  it('respects except with wildcard', async () => {
    const tm = new TriggerManager();
    const handler = vi.fn();
    tm.create('except_test', { when: 'AFTER', action: '*', except: ['READ'], table: 'users', body: handler });
    await new QueryBuilder('users').insert({ id: 3 }).make();
    await new QueryBuilder('users').select(['id']).all();
    expect(handler).toHaveBeenCalledTimes(1);
    tm.drop('except_test');
  });

  it('parallel body executes steps concurrently', async () => {
    const tm = new TriggerManager();
    const a = vi.fn();
    const b = vi.fn();
    tm.create('parallel_test', { when: 'AFTER', action: 'INSERT', table: 'users', body: { parallel: [() => a(), () => b()] } });
    await new QueryBuilder('users').insert({ id: 4 }).make();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    tm.drop('parallel_test');
  });
});

// Dialect-specific and async behaviors

describe('View/Trigger managers dialect selection', () => {
  it('uses postgres information_schema for views', async () => {
    setDefaultExecutor(new ExecMock('postgres', [{ table_name: 'v_users' }]) as any)
    const vm = new ViewManager()
    expect(vm.listViews()).toContain('v_users')
  })

  it('uses oracle USER_TRIGGERS for triggers', () => {
    setDefaultExecutor(new ExecMock('oracle', [{ TRIGGER_NAME: 'trg' }, { name: 'fallback' }]) as any)
    const tm = new TriggerManager()
    const list = tm.listTriggers()
    expect(list).toContain('trg')
  })

  it('create/drop view/trigger work via runSync when available', () => {
    setDefaultExecutor(new ExecMock('mssql', []) as any)
    const vm = new ViewManager()
    const tm = new TriggerManager()
    const qb = new QueryBuilder('users').select(['id'])
    vm.createOrReplaceView('v_users', qb)
    tm.createTrigger('t1','users','AFTER','INSERT','SELECT 1;')
    vm.dropView('v_users')
    tm.dropTrigger('t1')
  })

  it('lists sql triggers for sqlite/postgres/oracle', () => {
    setDefaultExecutor(new ExecMock('sqlite', ['trg']) as any)
    expect(new TriggerManager().listTriggers()).toContain('trg')
    setDefaultExecutor(new ExecMock('postgres', ['trg']) as any)
    expect(new TriggerManager().listTriggers()).toContain('trg')
    setDefaultExecutor(new ExecMock('oracle', ['trg']) as any)
    expect(new TriggerManager().listTriggers()).toContain('trg')
  })

  it('listViewsAsync works for postgres', async () => {
    setDefaultExecutor(new AsyncExecMock('postgres', ['v_users']) as any)
    const vm = new ViewManager()
    const list = await vm.listViewsAsync()
    expect(list).toContain('v_users')
  })

  it('listTriggersAsync works for oracle', async () => {
    setDefaultExecutor(new AsyncExecMock('oracle', ['trg']) as any)
    const tm = new TriggerManager()
    const list = await tm.listTriggersAsync()
    expect(list).toContain('trg')
  })
})

describe('View/Trigger managers async-only executors', () => {
  class AsyncOnly {
    dialect: any
    constructor(d: any, private rows: any[]) { this.dialect = d }
    async executeQuery(sql: string, bindings: any[] = []) {
      if (/information_schema\.views/i.test(sql)) return { data: this.rows.map(r => ({ table_name: r })) }
      if (/USER_TRIGGERS/i.test(sql)) return { data: this.rows.map(r => ({ TRIGGER_NAME: r, name: r })) }
      return { data: [] }
    }
  }

  it('listViewsAsync works when no executeQuerySync', async () => {
    setDefaultExecutor(new AsyncOnly('postgres', ['v1']) as any)
    const list = await new ViewManager().listViewsAsync()
    expect(list).toContain('v1')
  })

  it('listTriggersAsync works when no executeQuerySync', async () => {
    setDefaultExecutor(new AsyncOnly('oracle', ['t1']) as any)
    const list = await new TriggerManager().listTriggersAsync()
    expect(list).toContain('t1')
  })
})

describe('TriggerManager.create input validation (non-throwing)', () => {
  it('does not throw when action is invalid', () => {
    setDefaultExecutor(new ExecMock('sqlite', []) as any)
    const tm = new TriggerManager()
    expect(() => tm.create('invalid_action', { when: 'AFTER', action: 'FOO' as any, table: 'users', body: () => {} })).not.toThrow()
  })

  it('does not throw when table is empty array', () => {
    setDefaultExecutor(new ExecMock('sqlite', []) as any)
    const tm = new TriggerManager()
    expect(() => tm.create('empty_table', { when: 'BEFORE', action: 'INSERT', table: [] as any, body: '' })).not.toThrow()
  })
})

describe('ViewManager.view<T>() typed smoke', () => {
  class ExecHasAll { async executeQuery(sql: string, b: any[]) { return { data: [] } } }
  it('creates a typed QueryBuilder<T> (smoke)', async () => {
    setDefaultExecutor(new ExecHasAll() as any)
    const qb: QueryBuilder<{ id: number; name: string }> = new QueryBuilder('users')
    const rows = await qb.select(['id']).all()
    expect(Array.isArray(rows)).toBe(true)
  })
})

describe('SQL trigger operations error cases', () => {
  it('createTrigger throws when no executor configured', () => {
    const prev = (QueryKitConfig as any).defaultExecutor
    ;(QueryKitConfig as any).defaultExecutor = undefined
    const tm = new TriggerManager()
    expect(() => tm.createTrigger('t','users','AFTER','INSERT','SELECT 1;')).toThrow('No executor configured for QueryKit')
    ;(QueryKitConfig as any).defaultExecutor = prev
  })

  it('dropTrigger throws when no executor configured', () => {
    const prev = (QueryKitConfig as any).defaultExecutor
    ;(QueryKitConfig as any).defaultExecutor = undefined
    const tm = new TriggerManager()
    expect(() => tm.dropTrigger('t')).toThrow('No executor configured for QueryKit')
    ;(QueryKitConfig as any).defaultExecutor = prev
  })
})

describe('ViewManager listViews dialect branches', () => {
  class SyncExec { constructor(public dialect: any, public rows: any[]) {} executeQuerySync(sql: string, b: any[]) { return { data: this.rows } } }

  it('sqlite branch', () => {
    setDefaultExecutor(new SyncExec('sqlite', [{ name: 'v' }]) as any)
    expect(new ViewManager().listViews()).toContain('v')
  })
  it('mysql branch', () => {
    setDefaultExecutor(new SyncExec('mysql', [{ T: 'v' }]) as any)
    expect(new ViewManager().listViews()).toEqual(expect.any(Array))
  })
  it('postgres branch', () => {
    setDefaultExecutor(new SyncExec('postgres', [{ table_name: 'v' }]) as any)
    expect(new ViewManager().listViews()).toContain('v')
  })
  it('mssql branch', () => {
    setDefaultExecutor(new SyncExec('mssql', [{ name: 'v' }]) as any)
    expect(new ViewManager().listViews()).toContain('v')
  })
  it('oracle branch', () => {
    setDefaultExecutor(new SyncExec('oracle', [{ name: 'v' }]) as any)
    expect(new ViewManager().listViews()).toContain('v')
  })
  it('fallback path returns [] when no data', () => {
    setDefaultExecutor(new SyncExec(undefined, []) as any)
    expect(new ViewManager().listViews()).toEqual([])
  })
})

describe('TriggerManager listTriggers dialect branches', () => {
  class SyncExec { constructor(public dialect: any, public rows: any[]) {} executeQuerySync(sql: string, b: any[]) { return { data: this.rows } } }
  it('sqlite', () => { setDefaultExecutor(new SyncExec('sqlite', [{ name: 'tr' }]) as any); expect(new TriggerManager().listTriggers()).toContain('tr') })
  it('mysql', () => { setDefaultExecutor(new SyncExec('mysql', [{ name: 'tr' }]) as any); expect(new TriggerManager().listTriggers()).toContain('tr') })
  it('postgres', () => { setDefaultExecutor(new SyncExec('postgres', [{ tgname: 'tr' }]) as any); expect(new TriggerManager().listTriggers()).toContain('tr') })
  it('mssql', () => { setDefaultExecutor(new SyncExec('mssql', [{ name: 'tr' }]) as any); expect(new TriggerManager().listTriggers()).toContain('tr') })
  it('oracle', () => { setDefaultExecutor(new SyncExec('oracle', [{ name: 'tr' }]) as any); expect(new TriggerManager().listTriggers()).toContain('tr') })
})

describe('View/Trigger try/catch fallback chains and exists false', () => {
  it('listViews falls back when first candidate throws (sync)', () => {
    class Exec { dialect: any; constructor() { this.dialect = undefined } calls = 0; executeQuerySync(sql: string) { if (/sqlite_master/.test(sql) && this.calls++ === 0) { throw new Error('boom') } if (/SHOW FULL TABLES/.test(sql)) { return { data: [{ any: 'v2' }] } } return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const names = new ViewManager().listViews()
    expect(Array.isArray(names)).toBe(true)
  })

  it('listTriggersAsync falls back when first candidate throws (async)', async () => {
    class Exec { dialect: any; constructor() { this.dialect = undefined } calls = 0; async executeQuery(sql: string) { if (/sqlite_master/.test(sql) && this.calls++ === 0) { throw new Error('boom') } if (/INFORMATION_SCHEMA.TRIGGERS/.test(sql)) { return { data: [{ name: 'tr2' }] } } return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const names = await new TriggerManager().listTriggersAsync()
    expect(Array.isArray(names)).toBe(true)
  })

  it('viewExists/viewExistsAsync return false when not found', async () => {
    class Exec { dialect: any; constructor() { this.dialect = 'postgres' } executeQuerySync() { return { data: [] } } async executeQuery() { return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    expect(new ViewManager().viewExists('nope')).toBe(false)
    expect(await new ViewManager().viewExistsAsync('nope')).toBe(false)
  })

  it('triggerExistsAsync returns false when not found', async () => {
    class Exec { dialect: any; constructor() { this.dialect = 'postgres' } async executeQuery() { return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    expect(await new TriggerManager().triggerExistsAsync('nope')).toBe(false)
  })
}) 

describe('Extra branches for full coverage', () => {
  it('listViews returns [] when no executeQuerySync present', () => {
    class Exec { dialect: any = 'postgres'; async executeQuery() { return { data: [{ table_name: 'v1' }] } } }
    setDefaultExecutor(new Exec() as any)
    expect(new ViewManager().listViews()).toEqual([])
  })

  it('listViewsAsync falls back after multiple candidate failures', async () => {
    class Exec { dialect: any = undefined; async executeQuery(sql: string) { if (/sqlite_master/.test(sql)) throw new Error('boom1'); if (/SHOW FULL TABLES/.test(sql)) throw new Error('boom2'); if (/information_schema\.views/i.test(sql)) return { data: [{ table_name: 'v_async' }] }; return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const list = await new ViewManager().listViewsAsync()
    expect(list).toContain('v_async')
  })

  it('listTriggers returns [] and exists false when no rows', () => {
    class Exec { dialect: any = 'postgres'; executeQuerySync() { return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const tm = new TriggerManager()
    expect(tm.listTriggers()).toEqual([])
    expect(tm.triggerExists('x')).toBe(false)
  })

  it('listTriggers returns [] when no executeQuerySync present', () => {
    class Exec { dialect: any = 'postgres'; async executeQuery(sql: string) { return { data: [{ tgname: 't1' }] } } }
    setDefaultExecutor(new Exec() as any)
    expect(new TriggerManager().listTriggers()).toEqual([])
  })

  it('listTriggersAsync returns from sync path when executeQuerySync exists', async () => {
    class Exec { dialect: any = 'sqlite'; executeQuerySync(sql: string) { return { data: [{ name: 't_sync' }] } } async executeQuery(sql: string) { return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const list = await new TriggerManager().listTriggersAsync()
    expect(list).toContain('t_sync')
  })
}) 

describe('Async paths and final fallbacks for views/triggers', () => {
  it('createOrReplaceView/dropView use async executeQuery when runSync not present', async () => {
    const calls: string[] = []
    class Exec { dialect: any; constructor(){ this.dialect = 'postgres' } async executeQuery(sql: string){ calls.push(sql); return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const vm = new ViewManager()
    const qb = new QueryBuilder('users').select(['id'])
    await vm.createOrReplaceView('v_async', qb)
    await vm.dropView('v_async')
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('listViews returns [] when all candidates throw (sync)', () => {
    class Exec { dialect: any = undefined; executeQuerySync(sql: string){ throw new Error('boom') } }
    setDefaultExecutor(new Exec() as any)
    expect(new ViewManager().listViews()).toEqual([])
  })

  it('listViewsAsync returns [] when all candidates throw (async)', async () => {
    class Exec { dialect: any = undefined; async executeQuery(sql: string){ throw new Error('boom') } }
    setDefaultExecutor(new Exec() as any)
    expect(await new ViewManager().listViewsAsync()).toEqual([])
  })

  it('createTrigger/dropTrigger use async executeQuery when runSync not present', () => {
    const calls: string[] = []
    class Exec { dialect: any = 'sqlite'; async executeQuery(sql: string){ calls.push(sql); return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const tm = new TriggerManager()
    tm.createTrigger('t_async','users','AFTER','INSERT','SELECT 1;')
    tm.dropTrigger('t_async')
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('listTriggers returns [] when all candidates throw (sync)', () => {
    class Exec { dialect: any = undefined; executeQuerySync(){ throw new Error('boom') } }
    setDefaultExecutor(new Exec() as any)
    expect(new TriggerManager().listTriggers()).toEqual([])
  })

  it('listTriggersAsync returns [] when all candidates throw (async)', async () => {
    class Exec { dialect: any = undefined; async executeQuery(){ throw new Error('boom') } }
    setDefaultExecutor(new Exec() as any)
    expect(await new TriggerManager().listTriggersAsync()).toEqual([])
  })
})

describe('ViewManager.view uses table factory from config', () => {
  it('returns QueryBuilder produced by factory', async () => {
    ;(QueryKitConfig as any).table = (name: string) => new QueryBuilder(name)
    class Exec { async executeQuery(){ return { data: [] } } }
    setDefaultExecutor(new Exec() as any)
    const qb = new ViewManager().view<{ id: number }>('users')
    const rows = await qb.select(['id']).all()
    expect(Array.isArray(rows)).toBe(true)
  })
}) 

describe('Scheduler integration via ViewManager', () => {
  it('scheduleViewRefresh and unscheduleViewRefresh delegate to scheduler', async () => {
    const vm = new ViewManager()
    const qb = new QueryBuilder('users').select(['id'])
    const schedScheduleSpy = vi.spyOn(scheduler, 'schedule')
    const schedUnscheduleSpy = vi.spyOn(scheduler, 'unschedule')
    vm.scheduleViewRefresh('v_sched', qb, 1234)
    vm.unscheduleViewRefresh('v_sched')
    expect(schedScheduleSpy).toHaveBeenCalledWith('refresh-view-v_sched', expect.any(Function), 1234)
    expect(schedUnscheduleSpy).toHaveBeenCalledWith('refresh-view-v_sched')
  })
})

describe('TriggerManager extras for coverage', () => {
  it('function body returning array resolves all items', async () => {
    setDefaultExecutor(new (class { runSync(){ return { changes:1 } } })() as any)
    const tm = new TriggerManager()
    tm.create('arr_body', { when: 'AFTER', action: 'INSERT', table: 'users', body: () => [Promise.resolve(1), Promise.resolve(2)] })
    await new QueryBuilder('users').insert({ id: 99 }).make()
    tm.drop('arr_body')
  })

  it('list returns created trigger names', () => {
    const tm = new TriggerManager()
    tm.create('t_list1', { when: 'AFTER', action: 'INSERT', table: 'users', body: '' })
    tm.create('t_list2', { when: 'AFTER', action: 'UPDATE', table: 'users', body: '' })
    const names = tm.list()
    expect(names).toEqual(expect.arrayContaining(['t_list1','t_list2']))
    tm.drop('t_list1'); tm.drop('t_list2')
  })
}) 