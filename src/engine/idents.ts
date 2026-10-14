import { UnsafeIdentifierError } from '../sql/errors.js';

const IDENT_PART = /^(?:[\p{L}_][\p{L}\p{N}_]*|\*)$/u;

export function splitIdent(name: string): string[] {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new UnsafeIdentifierError('Identifier cannot be empty');
  const parts = trimmed.split('.').map((p) => p.trim());
  for (const part of parts) {
    if (!IDENT_PART.test(part)) {
      throw new UnsafeIdentifierError(
        `Unsafe SQL identifier '${trimmed}'. Identifiers may only contain letters, numbers, and underscore.`,
      );
    }
  }
  return parts;
}

export function wrapDouble(part: string): string {
  if (part === '*') return '*';
  return '"' + part.replace(/"/g, '""') + '"';
}

export function wrapBacktick(part: string): string {
  if (part === '*') return '*';
  return '`' + part.replace(/`/g, '``') + '`';
}

export function wrapBracket(part: string): string {
  if (part === '*') return '*';
  return '[' + part.replace(/]/g, ']]') + ']';
}
