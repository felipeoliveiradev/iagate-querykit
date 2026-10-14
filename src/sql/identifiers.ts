import type { SqlDialect } from './dialect.js';

const IDENT_PART = /^(?:[\p{L}_][\p{L}\p{N}_]*|\*)$/u;

export class UnsafeIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeIdentifierError';
  }
}

function wrapIdent(part: string, dialect: SqlDialect): string {
  if (part === '*') return '*';
  switch (dialect) {
    case 'mysql':
      return '`' + part.replace(/`/g, '``') + '`';
    case 'mssql':
      return '[' + part.replace(/]/g, ']]') + ']';
    default:
      return '"' + part.replace(/"/g, '""') + '"';
  }
}

function assertPart(part: string, source: string): void {
  if (!IDENT_PART.test(part)) {
    throw new UnsafeIdentifierError(
      `Unsafe SQL identifier '${source}'. Identifiers may only contain letters, numbers, and underscore.`,
    );
  }
}

/**
 * Quote a single identifier or dotted path (schema.table.column).
 * Rejects anything that is not a safe identifier part.
 */
export function quoteIdent(name: string, dialect: SqlDialect = 'sqlite'): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new UnsafeIdentifierError('Identifier cannot be empty');
  const parts = trimmed.split('.').map((p) => p.trim());
  for (const part of parts) assertPart(part, trimmed);
  return parts.map((p) => wrapIdent(p, dialect)).join('.');
}

const AS_RE = /^(.+?)\s+as\s+([\p{L}_][\p{L}\p{N}_]*)$/iu;

/**
 * Quote a table reference, including optional alias:
 * `users`, `users u`, `users AS u`, `main.users AS u`.
 */
export function quoteTableRef(ref: string, dialect: SqlDialect = 'sqlite'): string {
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

export function isSqlExpression(sql: string): boolean {
  return /[(),+\-/*]|case\s|when\s|cast\s|::/i.test(sql);
}

/**
 * Quote a SELECT item. Expressions (anything with parentheses or operators)
 * are passed through unchanged so `COUNT(id) AS total` keeps working.
 */
export function quoteSelectItem(item: string, dialect: SqlDialect = 'sqlite'): string {
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
