import { tryGetDialect } from '../engine/registry.js';
import '../dialects/register.js';

export type SqlDialect = 'sqlite' | 'mysql' | 'postgres' | 'mssql' | 'oracle';

export const SQL_DIALECTS: readonly SqlDialect[] = ['sqlite', 'mysql', 'postgres', 'mssql', 'oracle'];

export function isSqlDialect(value: unknown): value is SqlDialect {
  return typeof value === 'string' && (SQL_DIALECTS as readonly string[]).includes(value);
}

export function normalizeDialect(value: unknown, fallback: SqlDialect = 'sqlite'): SqlDialect {
  if (value === 'postgresql') return 'postgres';
  if (isSqlDialect(value)) return value;
  return fallback;
}

/**
 * True when the statement is expected to return a result set.
 * Handles leading comments and CTEs, unlike a naive /^select/ test.
 */
export function isSelectLike(sql: string): boolean {
  const stripped = String(sql || '')
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .trim();
  return /^(select|pragma|explain|values|show|describe|with)\b/i.test(stripped);
}

export function applyPaging(
  sql: string,
  dialect: SqlDialect | string,
  limit: number | undefined,
  offset: number | undefined,
  bindings: unknown[],
): string {
  const plugin = tryGetDialect(dialect);
  if (plugin) return plugin.applyPaging(sql, limit, offset, bindings);
  return sql;
}

export function returningInsertSql(
  sql: string,
  dialect: SqlDialect | string,
  primaryKey = 'id',
): string {
  const plugin = tryGetDialect(dialect);
  if (plugin) return plugin.returningInsertSql(sql, primaryKey);
  return sql;
}
