import type {
  DatabaseExecutor,
  EventBus,
  MultiDbRegistry,
  RelationsRegistry,
  SimulationController,
} from './types.js';
import type { SqlDialect } from './sql/dialect.js';

export const QueryKitConfig: {
  defaultExecutor?: DatabaseExecutor;
  eventBus?: EventBus;
  simulation?: SimulationController;
  multiDb?: MultiDbRegistry;
  databaseName?: string;
  defaultDialect?: SqlDialect;
  tableToDatabase?: Record<string, string>;
  executorResolver?: (tableName: string) => DatabaseExecutor | undefined;
  relations?: RelationsRegistry;
} = {};

export function setDefaultExecutor(executor: DatabaseExecutor): void {
  QueryKitConfig.defaultExecutor = executor;
}

export function setEventBus(bus: EventBus): void {
  QueryKitConfig.eventBus = bus;
}

export function setSimulationController(sim: SimulationController): void {
  QueryKitConfig.simulation = sim;
}

export function setMultiDbRegistry(reg: MultiDbRegistry): void {
  QueryKitConfig.multiDb = reg;
}

export function setDatabaseName(name: string): void {
  QueryKitConfig.databaseName = name;
}

export function setDefaultDialect(dialect: SqlDialect): void {
  QueryKitConfig.defaultDialect = dialect;
}

export function setTableToDatabase(map: Record<string, string>): void {
  QueryKitConfig.tableToDatabase = map;
}

export function setExecutorResolver(resolver: (tableName: string) => DatabaseExecutor | undefined): void {
  QueryKitConfig.executorResolver = resolver;
}

export function setRelations(registry: RelationsRegistry): void {
  QueryKitConfig.relations = registry;
}

export function resetQueryKitConfig(): void {
  delete QueryKitConfig.defaultExecutor;
  delete QueryKitConfig.eventBus;
  delete QueryKitConfig.simulation;
  delete QueryKitConfig.multiDb;
  delete QueryKitConfig.databaseName;
  delete QueryKitConfig.defaultDialect;
  delete QueryKitConfig.tableToDatabase;
  delete QueryKitConfig.executorResolver;
  delete QueryKitConfig.relations;
}

export function getExecutorForTable(tableName: string, banksHint?: string[]): DatabaseExecutor {
  const cfg = QueryKitConfig;
  if (cfg.executorResolver) {
    const ex = cfg.executorResolver(tableName);
    if (ex) return ex;
  }
  if (banksHint && cfg.multiDb) {
    for (const db of banksHint) {
      try {
        const ex = cfg.multiDb.getAdapter(db);
        if (ex) return ex;
      } catch {
        /* try next bank */
      }
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

export function resolveDialect(executor?: DatabaseExecutor, fallback: SqlDialect = 'sqlite'): SqlDialect {
  return executor?.dialect || QueryKitConfig.defaultDialect || fallback;
}
