import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setDefaultExecutor } from '../config';
import { ViewManager } from '../view-manager';
import { TriggerManager } from '../trigger-manager';
import { QueryBuilder } from '../query-builder';

class MockExec {
  rows: any[] = [];
  executeQuerySync(sql: string, bindings: any[] = []) { return { data: this.rows.slice() }; }
  executeQuery(sql: string, bindings: any[] = []) { return Promise.resolve({ data: this.rows.slice() }); }
  runSync(sql: string, bindings: any[] = []) { return { changes: 1, lastInsertRowid: 1 }; }
}

describe('ViewManager & TriggerManager', () => {
  let exec: MockExec;
  beforeEach(() => { exec = new MockExec(); setDefaultExecutor(exec as any); });

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
    tm.create('audit_insert', {
      when: 'AFTER', action: 'INSERT', table: 'users',
      body: `INSERT INTO audit_log(action) VALUES('INSERT')`
    });
    await new QueryBuilder('users').insert({ id: 1, name: 'A' }).make();
    expect(spy).toHaveBeenCalled();
    tm.drop('audit_insert');
  });

  it('semantic trigger executes function body', async () => {
    const tm = new TriggerManager();
    const handler = vi.fn();
    tm.create('fn_after_update', {
      when: 'AFTER', action: 'UPDATE', table: 'users',
      body: async (ctx) => { handler(ctx.table, ctx.action, ctx.timing); }
    });
    await new QueryBuilder('users').where('id','=',1).update({ name: 'B' }).make();
    expect(handler).toHaveBeenCalledWith('users','UPDATE','AFTER');
    tm.drop('fn_after_update');
  });

  it('supports multiple actions and tables, including * wildcard', async () => {
    const tm = new TriggerManager();
    const calls: any[] = [];
    tm.create('multi', {
      when: 'AFTER', action: ['*'], table: ['users','orders'],
      body: [(ctx) => calls.push(`${ctx.action}:${ctx.table}`)]
    });
    await new QueryBuilder('users').insert({ id: 1 }).make();
    await new QueryBuilder('users').where('id','=',1).update({ name: 'X' }).make();
    await new QueryBuilder('orders').where('id','=',1).delete().make();
    exec.rows = [{ id: 1 }];
    await new QueryBuilder('users').select(['id']).all();
    expect(calls).toEqual(expect.arrayContaining([
      'INSERT:users','UPDATE:users','DELETE:orders','READ:users'
    ]));
    tm.drop('multi');
  });

  it('array body runs all steps sequentially', async () => {
    const tm = new TriggerManager();
    const spy = vi.spyOn(exec, 'runSync');
    tm.create('batch', {
      when: 'AFTER', action: 'INSERT', table: 'users',
      body: [
        `SELECT 1;`,
        async () => { await new QueryBuilder('logs').insert({ ok: 1 }).make(); }
      ]
    });
    await new QueryBuilder('users').insert({ id: 2 }).make();
    expect(spy).toHaveBeenCalled();
    tm.drop('batch');
  });

  it('respects except with wildcard', async () => {
    const tm = new TriggerManager();
    const handler = vi.fn();
    tm.create('except_test', {
      when: 'AFTER', action: '*', except: ['READ'], table: 'users',
      body: handler
    });
    await new QueryBuilder('users').insert({ id: 3 }).make();
    await new QueryBuilder('users').select(['id']).all();
    expect(handler).toHaveBeenCalledTimes(1);
    tm.drop('except_test');
  });

  it('parallel body executes steps concurrently', async () => {
    const tm = new TriggerManager();
    const a = vi.fn();
    const b = vi.fn();
    tm.create('parallel_test', {
      when: 'AFTER', action: 'INSERT', table: 'users',
      body: { parallel: [() => a(), () => b()] }
    });
    await new QueryBuilder('users').insert({ id: 4 }).make();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    tm.drop('parallel_test');
  });
}); 