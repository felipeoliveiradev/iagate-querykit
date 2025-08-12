import { describe, it, expect, beforeEach } from 'vitest';
import { simulationManager } from '../simulation-manager';
import { QueryBuilder } from '../query-builder';
import { setDefaultExecutor } from '../config';
import { QueryKitConfig } from '../config';

class ExecMock {
  rows: any[] = [{ id: 1, a: 1 }, { id: 2, a: 2 }]
  executeQuery(sql: string, bindings: any[]) { return Promise.resolve({ data: this.rows.slice() }) }
}

describe('SimulationManager', () => {
  beforeEach(() => { setDefaultExecutor(new ExecMock() as any); simulationManager.stop() })

  it('starts with initial arrays and returns state', async () => {
    const state = { users: [{ id: 1, name: 'A' }] } as any;
    await simulationManager.start(state);
    expect(simulationManager.isActive()).toBe(true);
    expect(simulationManager.getStateFor('users')).toEqual(state.users);
    simulationManager.stop();
  });

  it('can seed from QueryBuilder', async () => {
    const qb = new QueryBuilder('users').select(['id']);
    await simulationManager.start({ users: qb } as any);
    expect(simulationManager.getStateFor('users')).toBeDefined();
    simulationManager.stop();
  });

  it('updates and deletes reflect in virtual state with tracking', async () => {
    await simulationManager.start({ t: [{ id: 1, a: 1 }, { id: 2, a: 2 }] })
    const qb = new QueryBuilder<any>('t')
    await qb.initial()
    qb.where('id','=',1).update({ a: 10 })
    const logs = qb.tracking()
    expect(Array.isArray(logs)).toBe(true)
    const afterUpdate = await new QueryBuilder<any>('t').all()
    expect(afterUpdate.find(r => r.id === 1)?.a).toBe(10)

    const delQ = new QueryBuilder<any>('t')
    await delQ.initial([{ id: 1, a: 10 }, { id: 2, a: 2 }])
    delQ.where('id','=',2).delete()
    delQ.tracking()
    const afterDelete = await new QueryBuilder<any>('t').all()
    expect(afterDelete.find(r => r.id === 2)).toBeUndefined()
  })

  it('delegates to QueryKitConfig.simulation when provided', async () => {
    const calls: string[] = []
    const proxy = {
      isActive: () => true,
      getStateFor: (t: string) => (calls.push('get'), [{ id: 1 }]),
      updateStateFor: (t: string, d: any[]) => calls.push('update'),
      start: async (init: any) => calls.push('start'),
      stop: () => calls.push('stop')
    }
    ;(QueryKitConfig as any).simulation = proxy as any
    await simulationManager.start({ t: [{ id: 1 }] } as any)
    expect(simulationManager.isActive()).toBe(true)
    expect(simulationManager.getStateFor('t')?.length).toBe(1)
    simulationManager.stop()
    ;(QueryKitConfig as any).simulation = undefined
  })

  it('tracking adds dry_run_select.summary when enabled and no pending action', async () => {
    await simulationManager.start({})
    const qb = new QueryBuilder('logs')
    await qb.initial([{ id: 1, a: 1 } as any])
    const logs = qb.tracking()
    expect(logs.some(l => l.step === 'dry_run_select.summary')).toBe(true)
    simulationManager.stop()
  })

  it('virtual update with operator other than = applies to all rows (applyWhereClauses else branch)', async () => {
    await simulationManager.start({ t: [{ id: 1, a: 1 }, { id: 2, a: 2 }] as any })
    const qb = new QueryBuilder<any>('t')
    await qb.initial()
    qb.where('a','>',0).update({ b: 9 })
    const logs = qb.tracking()
    const state = simulationManager.getStateFor('t') as any[]
    expect(state.every(r => r.b === 9)).toBe(true)
    simulationManager.stop()
  })

  it('all() returns [] when simulation active and table has no data in state', async () => {
    await simulationManager.start({ other: [{ id: 1 }] as any })
    const rows = await new QueryBuilder('missing').all()
    expect(rows).toEqual([])
    simulationManager.stop()
  })
}); 