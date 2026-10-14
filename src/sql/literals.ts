/**
 * Escape a value as a SQL literal. Used only where the engine cannot bind
 * parameters (CREATE VIEW AS …). Identifiers must still go through quoteIdent.
 */
export function escapeSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `X'${value.toString('hex')}'`;
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function inlineBindings(sql: string, bindings: unknown[]): string {
  if (!bindings || bindings.length === 0) return sql;
  let i = 0;
  let out = '';
  let idx = 0;
  const s = sql;
  const n = s.length;
  while (idx < n) {
    const ch = s[idx]!;
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      idx += 1;
      while (idx < n) {
        const c = s[idx]!;
        out += c;
        idx += 1;
        if (c === quote) {
          if (s[idx] === quote) {
            out += s[idx];
            idx += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (ch === '-' && s[idx + 1] === '-') {
      const end = s.indexOf('\n', idx);
      const stop = end === -1 ? n : end + 1;
      out += s.slice(idx, stop);
      idx = stop;
      continue;
    }
    if (ch === '/' && s[idx + 1] === '*') {
      const end = s.indexOf('*/', idx + 2);
      const stop = end === -1 ? n : end + 2;
      out += s.slice(idx, stop);
      idx = stop;
      continue;
    }
    if (ch === '?') {
      if (i >= bindings.length) {
        out += '?';
      } else {
        out += escapeSqlLiteral(bindings[i++]);
      }
      idx += 1;
      continue;
    }
    out += ch;
    idx += 1;
  }
  return out;
}
