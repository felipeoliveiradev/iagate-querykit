import type { SqlDialect } from './dialect.js';

/**
 * Documented per-statement bind-parameter ceilings.
 * SQLite historically compiled with SQLITE_MAX_VARIABLE_NUMBER=999;
 * current amalgamation defaults to 32766. We default to the portable 999
 * and expose the modern ceiling for callers that know their build.
 */
export const DIALECT_MAX_BIND_PARAMS: Record<SqlDialect, number> = {
  sqlite: 999,
  mysql: 65535,
  postgres: 65535,
  mssql: 2100,
  oracle: 65535,
};

export const SQLITE_MAX_BIND_PARAMS_LEGACY = 999;
export const SQLITE_MAX_BIND_PARAMS_MODERN = 32766;

export function maxBindParams(dialect: SqlDialect, override?: number): number {
  if (typeof override === 'number') {
    if (!Number.isInteger(override) || override < 1) {
      throw new Error('maxBindParams override must be a positive integer');
    }
    return override;
  }
  return DIALECT_MAX_BIND_PARAMS[dialect] ?? 999;
}

/**
 * Split rows so each chunk's flattened bindings stay under `maxParams`.
 * A single row that itself exceeds the limit is rejected by the caller.
 */
export function chunkRowsByBindLimit<T>(
  rows: readonly T[],
  columnsPerRow: number,
  maxParams: number,
): T[][] {
  if (!rows.length) return [];
  if (columnsPerRow < 1) throw new Error('chunkRowsByBindLimit requires columnsPerRow >= 1');
  if (maxParams < 1) throw new Error('chunkRowsByBindLimit requires maxParams >= 1');
  const maxRows = Math.max(1, Math.floor(maxParams / columnsPerRow));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += maxRows) {
    chunks.push(rows.slice(i, i + maxRows) as T[]);
  }
  return chunks;
}
