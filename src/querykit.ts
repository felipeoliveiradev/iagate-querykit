import { QueryBuilder } from './query-builder.js';
import type { DatabaseExecutor } from './types.js';

export type QueryKit = {
  readonly executor: DatabaseExecutor;
  table<T = any>(name: string): QueryBuilder<T>;
  query<T = any>(name: string): QueryBuilder<T>;
  transaction<T>(fn: (kit: QueryKit) => Promise<T>): Promise<T>;
  close(): Promise<void> | void;
};

/**
 * Preferred v2 entry: a kit bound to one executor.
 * Builders created from the kit do not read the process-wide QueryKitConfig
 * unless the caller also configured the global default.
 */
export function createQueryKit(executor: DatabaseExecutor): QueryKit {
  if (!executor || typeof executor.executeQuery !== 'function') {
    throw new Error('createQueryKit requires a DatabaseExecutor with executeQuery()');
  }
  if (!executor.dialect) {
    throw new Error('createQueryKit requires executor.dialect');
  }

  const bind = (exec: DatabaseExecutor): QueryKit => ({
    executor: exec,
    table<T = any>(name: string) {
      return new QueryBuilder<T>(name, { executor: exec });
    },
    query<T = any>(name: string) {
      return new QueryBuilder<T>(name, { executor: exec });
    },
    async transaction<T>(fn: (kit: QueryKit) => Promise<T>): Promise<T> {
      if (!exec.transaction) {
        throw new Error('Executor does not support transactions');
      }
      return exec.transaction((tx) => fn(bind(tx)));
    },
    close() {
      return exec.close?.();
    },
  });

  return bind(executor);
}
