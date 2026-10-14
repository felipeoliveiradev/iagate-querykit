import { QueryBuilder } from './query-builder.js';
import type { DatabaseExecutor } from './types.js';
import type { Dialect } from './engine/dialect.js';
import { getDialect } from './engine/registry.js';
import './dialects/register.js';

export type QueryKit = {
  readonly executor: DatabaseExecutor;
  table<T = any>(name: string): QueryBuilder<T>;
  query<T = any>(name: string): QueryBuilder<T>;
  transaction<T>(fn: (kit: QueryKit) => Promise<T>): Promise<T>;
  close(): Promise<void> | void;
};

export type QueryKitCreateOptions = {
  dialect?: Dialect | string;
  driver: DatabaseExecutor;
};

function isExecutor(value: unknown): value is DatabaseExecutor {
  return !!value && typeof (value as DatabaseExecutor).executeQuery === 'function';
}

/**
 * Preferred v2 entry: a kit bound to one executor (and optionally a dialect plugin).
 * Builders created from the kit do not read the process-wide QueryKitConfig
 * unless the caller also configured the global default.
 *
 * Overloads:
 * - `createQueryKit(executor)`
 * - `createQueryKit({ dialect, driver })` — constructor injection, no singleton
 */
export function createQueryKit(executor: DatabaseExecutor): QueryKit;
export function createQueryKit(options: QueryKitCreateOptions): QueryKit;
export function createQueryKit(input: DatabaseExecutor | QueryKitCreateOptions): QueryKit {
  let driver: DatabaseExecutor;
  let dialect: Dialect | string | undefined;

  if (isExecutor(input)) {
    driver = input;
  } else {
    if (!input || !isExecutor(input.driver)) {
      throw new Error('createQueryKit requires a DatabaseExecutor with executeQuery()');
    }
    driver = input.driver;
    dialect = input.dialect;
  }

  if (!driver.dialect && dialect) {
    const plugin = getDialect(dialect);
    Object.assign(driver, { dialect: plugin.name });
  }
  if (!driver.dialect) {
    throw new Error('createQueryKit requires executor.dialect (or options.dialect)');
  }

  const bound = dialect ? getDialect(dialect) : undefined;

  const bind = (exec: DatabaseExecutor): QueryKit => ({
    executor: exec,
    table<T = any>(name: string) {
      return new QueryBuilder<T>(name, { executor: exec, dialect: bound });
    },
    query<T = any>(name: string) {
      return new QueryBuilder<T>(name, { executor: exec, dialect: bound });
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

  return bind(driver);
}
