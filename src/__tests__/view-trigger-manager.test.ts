import { describe, it, expect, beforeEach } from 'vitest';
import { setDefaultExecutor } from '../config';
import { ViewManager } from '../view-manager';
import { TriggerManager } from '../trigger-manager';
import { QueryBuilder } from '../query-builder';

class MockExec {
  rows: any[] = [];
  executeQuerySync(sql: string, bindings: any[] = []) { return { data: this.rows.slice() }; }
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

  it('creates and drops triggers', () => {
    const tm = new TriggerManager();
    tm.createTrigger('trg', 'users', 'AFTER', 'INSERT', 'SELECT 1;');
    exec.rows = [{ name: 'trg' }];
    expect(tm.listTriggers()).toEqual(['trg']);
    expect(tm.triggerExists('trg')).toBe(true);
    tm.dropTrigger('trg');
  });
}); 