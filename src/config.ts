import type { DatabaseExecutor, EventBus, SimulationController, MultiDbRegistry } from './types';

export const QueryKitConfig: {
  defaultExecutor?: DatabaseExecutor;
  eventBus?: EventBus;
  simulation?: SimulationController;
  multiDb?: MultiDbRegistry;
} = {};

export function setDefaultExecutor(executor: DatabaseExecutor) { QueryKitConfig.defaultExecutor = executor; }
export function setEventBus(bus: EventBus) { QueryKitConfig.eventBus = bus; }
export function setSimulationController(sim: SimulationController) { QueryKitConfig.simulation = sim; }
export function setMultiDbRegistry(reg: MultiDbRegistry) { QueryKitConfig.multiDb = reg; } 