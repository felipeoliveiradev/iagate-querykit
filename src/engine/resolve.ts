import type { Dialect } from './dialect.js';
import { getDialect, tryGetDialect } from './registry.js';

/**
 * Resolve a dialect plugin from a name or instance.
 * Unknown names fall back to sqlite so legacy callers that only set
 * `defaultDialect` keep compiling; plugin authors should use getDialect()
 * when they want a hard failure.
 */
export function resolveEngine(name?: string | Dialect): Dialect {
  if (name && typeof name === 'object' && typeof name.quoteIdent === 'function') {
    return name;
  }
  return tryGetDialect(name as string | undefined) || getDialect('sqlite');
}
