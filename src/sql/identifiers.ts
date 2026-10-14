import type { SqlDialect } from './dialect.js';
import { UnsafeIdentifierError } from './errors.js';
import { tryGetDialect } from '../engine/registry.js';
import { splitIdent, wrapDouble } from '../engine/idents.js';
import type { Dialect } from '../engine/dialect.js';
import { isSqlExpression } from '../dialects/quoting.js';
import '../dialects/register.js';

export { UnsafeIdentifierError };

const IDENT_PART = /^(?:[\p{L}_][\p{L}\p{N}_]*|\*)$/u;

function resolveQuote(dialect: SqlDialect | Dialect | undefined): Dialect | undefined {
  if (dialect && typeof dialect === 'object' && typeof (dialect as Dialect).quoteIdent === 'function') {
    return dialect as Dialect;
  }
  return tryGetDialect((dialect as SqlDialect) || 'sqlite');
}

/**
 * Quote a single identifier or dotted path (schema.table.column).
 * Rejects anything that is not a safe identifier part.
 */
export function quoteIdent(name: string, dialect: SqlDialect | Dialect = 'sqlite'): string {
  const plugin = resolveQuote(dialect);
  if (plugin) return plugin.quoteIdent(name);
  return splitIdent(name).map(wrapDouble).join('.');
}

const AS_RE = /^(.+?)\s+as\s+([\p{L}_][\p{L}\p{N}_]*)$/iu;

/**
 * Quote a table reference, including optional alias:
 * `users`, `users u`, `users AS u`, `main.users AS u`.
 */
export function quoteTableRef(ref: string, dialect: SqlDialect | Dialect = 'sqlite'): string {
  const plugin = resolveQuote(dialect);
  if (plugin) return plugin.quoteTableRef(ref);
  const trimmed = String(ref || '').trim();
  if (!trimmed) throw new UnsafeIdentifierError('Table name cannot be empty');
  const asMatch = trimmed.match(AS_RE);
  if (asMatch) {
    return `${quoteIdent(asMatch[1]!.trim(), dialect)} AS ${quoteIdent(asMatch[2]!.trim(), dialect)}`;
  }
  const spaced = trimmed.split(/\s+/);
  if (spaced.length === 2 && IDENT_PART.test(spaced[1]!)) {
    return `${quoteIdent(spaced[0]!, dialect)} ${quoteIdent(spaced[1]!, dialect)}`;
  }
  return quoteIdent(trimmed, dialect);
}

export { isSqlExpression };

/**
 * Quote a SELECT item. Expressions (anything with parentheses or operators)
 * are passed through unchanged so `COUNT(id) AS total` keeps working.
 */
export function quoteSelectItem(item: string, dialect: SqlDialect | Dialect = 'sqlite'): string {
  const plugin = resolveQuote(dialect);
  if (plugin) return plugin.quoteSelectItem(item);
  const trimmed = String(item || '').trim();
  if (trimmed === '') throw new UnsafeIdentifierError('Identifier cannot be empty');
  if (trimmed === '*') return '*';
  if (isSqlExpression(trimmed)) return trimmed;
  const asMatch = trimmed.match(AS_RE);
  if (asMatch) {
    const left = asMatch[1]!.trim();
    const alias = asMatch[2]!.trim();
    if (isSqlExpression(left)) return `${left} AS ${quoteIdent(alias, dialect)}`;
    return `${quoteIdent(left, dialect)} AS ${quoteIdent(alias, dialect)}`;
  }
  return quoteIdent(trimmed, dialect);
}

export function quoteIdentList(names: string[], dialect: SqlDialect = 'sqlite'): string {
  return names.map((n) => quoteIdent(n, dialect)).join(', ');
}

export function isSafeIdent(name: string): boolean {
  try {
    quoteIdent(name, 'sqlite');
    return true;
  } catch {
    return false;
  }
}
