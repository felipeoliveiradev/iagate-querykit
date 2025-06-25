import { describe, it, expect } from 'vitest';
import { simulationManager } from '../simulation-manager';
import { QueryBuilder } from '../query-builder';

describe('SimulationManager', () => {
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
}); 