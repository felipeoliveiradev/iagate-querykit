import { sqliteDialect } from './sqlite/index.js';
import { postgresDialect } from './postgres/index.js';
import { mysqlDialect } from './mysql/index.js';
import { oracleDialect } from './oracle/index.js';
import { mssqlDialect } from './mssql/index.js';
import { memoryDialect } from './memory/index.js';

export const builtInDialects = {
  sqlite: sqliteDialect,
  postgres: postgresDialect,
  mysql: mysqlDialect,
  oracle: oracleDialect,
  mssql: mssqlDialect,
  memory: memoryDialect,
};

export function registerBuiltInDialects(): void {
  /* side-effect imports above call registerDialect */
}

registerBuiltInDialects();
