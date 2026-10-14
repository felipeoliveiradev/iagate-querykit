/**
 * Replace positional `?` placeholders that are **outside** quotes and comments.
 * Postgres `$n`, Oracle `:n`, and MSSQL `@pN` converters share this walker so
 * `?` inside `'...'`, `"..."`, `--` comments, and `/* *\/` comments is left alone.
 */
export function replacePlaceholdersOutsideLiterals(
  sql: string,
  replacer: (index: number) => string,
): string {
  let out = '';
  let i = 0;
  let placeholderIndex = 0;
  const s = sql;
  const n = s.length;

  while (i < n) {
    const ch = s[i]!;

    if (ch === '-' && s[i + 1] === '-') {
      const end = s.indexOf('\n', i);
      const stop = end === -1 ? n : end + 1;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < n) {
        const c = s[i]!;
        out += c;
        i += 1;
        if (c === quote) {
          if (s[i] === quote) {
            out += s[i];
            i += 1;
            continue;
          }
          break;
        }
        if (c === '\\' && quote === '\'' && i < n) {
          out += s[i];
          i += 1;
        }
      }
      continue;
    }

    if (ch === '?') {
      let look = i + 1;
      while (look < n && /\s/.test(s[look]!)) look += 1;
      const next = s[look];
      // Postgres jsonb operators: ?, ?|, ?&
      if (next === '|' || next === '&' || next === '\'' || next === '"') {
        out += ch;
        i += 1;
        continue;
      }
      placeholderIndex += 1;
      out += replacer(placeholderIndex);
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function toPostgresParams(sql: string): string {
  return replacePlaceholdersOutsideLiterals(sql, (i) => `$${i}`);
}

export function toOracleParams(sql: string): string {
  return replacePlaceholdersOutsideLiterals(sql, (i) => `:${i}`);
}

export function toMssqlParams(sql: string): { sql: string; paramNames: string[] } {
  const paramNames: string[] = [];
  const out = replacePlaceholdersOutsideLiterals(sql, (i) => {
    const name = `p${i}`;
    paramNames.push(name);
    return `@${name}`;
  });
  return { sql: out, paramNames };
}

export function countPlaceholders(sql: string): number {
  let count = 0;
  replacePlaceholdersOutsideLiterals(sql, () => {
    count += 1;
    return '?';
  });
  return count;
}
