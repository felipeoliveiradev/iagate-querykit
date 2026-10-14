import { UnsafeIdentifierError } from '../sql/errors.js';
import { splitIdent } from '../engine/idents.js';

export function isSqlExpression(sql: string): boolean {
  return /[(),+\-/*]|case\s|when\s|cast\s|::/i.test(sql);
}

const AS_RE = /^(.+?)\s+as\s+([\p{L}_][\p{L}\p{N}_]*)$/iu;
const IDENT_PART = /^(?:[\p{L}_][\p{L}\p{N}_]*|\*)$/u;

export function makeQuoter(wrap: (part: string) => string) {
  const quoteIdent = (name: string): string => splitIdent(name).map(wrap).join('.');

  const quoteTableRef = (ref: string): string => {
    const trimmed = String(ref || '').trim();
    if (!trimmed) throw new UnsafeIdentifierError('Table name cannot be empty');
    const asMatch = trimmed.match(AS_RE);
    if (asMatch) return `${quoteIdent(asMatch[1]!.trim())} AS ${quoteIdent(asMatch[2]!.trim())}`;
    const spaced = trimmed.split(/\s+/);
    if (spaced.length === 2 && IDENT_PART.test(spaced[1]!)) {
      return `${quoteIdent(spaced[0]!)} ${quoteIdent(spaced[1]!)}`;
    }
    return quoteIdent(trimmed);
  };

  const quoteSelectItem = (item: string): string => {
    const trimmed = String(item || '').trim();
    if (trimmed === '') throw new UnsafeIdentifierError('Identifier cannot be empty');
    if (trimmed === '*') return '*';
    if (isSqlExpression(trimmed)) return trimmed;
    const asMatch = trimmed.match(AS_RE);
    if (asMatch) {
      const left = asMatch[1]!.trim();
      const alias = asMatch[2]!.trim();
      if (isSqlExpression(left)) return `${left} AS ${quoteIdent(alias)}`;
      return `${quoteIdent(left)} AS ${quoteIdent(alias)}`;
    }
    return quoteIdent(trimmed);
  };

  return { quoteIdent, quoteTableRef, quoteSelectItem };
}
