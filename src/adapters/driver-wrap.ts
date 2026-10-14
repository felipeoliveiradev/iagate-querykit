import { wrapDriverCall, wrapDriverSync } from '../engine/errors.js';
import { getDialect } from '../engine/registry.js';
import '../dialects/register.js';

export function mapBindings(dialect: string, bindings: unknown[] = []): unknown[] {
  const plugin = getDialect(dialect);
  return bindings.map((v) => plugin.bind(v));
}

export function toNativeSql(dialect: string, sql: string): { sql: string; paramNames?: string[] } {
  return getDialect(dialect).toDriverParams(sql);
}

export function hydrateResult<T>(dialect: string, value: T): T {
  return getDialect(dialect).hydrate(value) as T;
}

export async function runDriver<T>(
  dialect: string,
  sql: string,
  bindings: unknown[],
  fn: () => Promise<T> | T,
): Promise<T> {
  return wrapDriverCall(fn, { dialect, sql, bindings });
}

export function runDriverSync<T>(dialect: string, sql: string, bindings: unknown[], fn: () => T): T {
  return wrapDriverSync(fn, { dialect, sql, bindings });
}
