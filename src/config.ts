import type { DatabaseExecutor, EventBus, SimulationController, MultiDbRegistry } from './types';

export const QueryKitConfig: {
  defaultExecutor?: DatabaseExecutor;
  eventBus?: EventBus;
  simulation?: SimulationController;
  multiDb?: MultiDbRegistry;
  databaseName?: string;
  defaultDialect?: 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle';
  tableToDatabase?: Record<string, string>;
  executorResolver?: (tableName: string) => DatabaseExecutor | undefined;
} = {} as any;

export function setDefaultExecutor(executor: DatabaseExecutor) { QueryKitConfig.defaultExecutor = executor; }
export function setEventBus(bus: EventBus) { QueryKitConfig.eventBus = bus; }
export function setSimulationController(sim: SimulationController) { QueryKitConfig.simulation = sim; }
export function setMultiDbRegistry(reg: MultiDbRegistry) { QueryKitConfig.multiDb = reg; }
export function setDatabaseName(name: string) { (QueryKitConfig as any).databaseName = name; }
export function setDefaultDialect(dialect: 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle') { (QueryKitConfig as any).defaultDialect = dialect; }
export function setTableToDatabase(map: Record<string, string>) { (QueryKitConfig as any).tableToDatabase = map; }
export function setExecutorResolver(resolver: (tableName: string) => DatabaseExecutor | undefined) { (QueryKitConfig as any).executorResolver = resolver; }

export function getExecutorForTable(tableName: string, banksHint?: string[] | undefined): DatabaseExecutor {
  const cfg: any = QueryKitConfig as any;
  if (cfg.executorResolver) {
    const ex = cfg.executorResolver(tableName);
    if (ex) return ex;
  }
  if (banksHint && cfg.multiDb) {
    for (const db of banksHint) {
      try { const ex = cfg.multiDb.getAdapter(db); if (ex) return ex; } catch {}
    }
  }
  if (cfg.tableToDatabase && cfg.multiDb) {
    const db = cfg.tableToDatabase[tableName];
    if (db) return cfg.multiDb.getAdapter(db);
  }
  if (cfg.multiDb && cfg.databaseName) {
    return cfg.multiDb.getAdapter(cfg.databaseName);
  }
  if (!cfg.defaultExecutor) throw new Error('No executor configured for QueryKit');
  return cfg.defaultExecutor;
} 