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
  dialect: SqlDialect,
  limit: number | undefined,
  offset: number | undefined,
  bindings: unknown[],
): string {
  const hasLimit = typeof limit === 'number';
  const hasOffset = typeof offset === 'number';
  if (!hasLimit && !hasOffset) return sql;

  if (dialect === 'mssql' || dialect === 'oracle') {
    let out = sql;
    if (!/\border\s+by\b/i.test(out)) {
      out += dialect === 'mssql' ? ' ORDER BY (SELECT NULL)' : ' ORDER BY 1';
    }
    const off = hasOffset ? offset! : 0;
    const lim = hasLimit ? limit! : 0;
    if (hasOffset && hasLimit) {
      out += ' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY';
      bindings.push(off, lim);
    } else if (hasOffset) {
      out += ' OFFSET ? ROWS';
      bindings.push(off);
    } else {
      out += ' OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY';
      bindings.push(lim);
    }
    return out;
  }

  if (hasLimit) {
    sql += ' LIMIT ?';
    bindings.push(limit);
  } else if (hasOffset && dialect === 'sqlite') {
    // SQLite rejects OFFSET without LIMIT. LIMIT -1 means "no cap".
    sql += ' LIMIT -1';
  } else if (hasOffset && dialect === 'mysql') {
    // MySQL rejects OFFSET without LIMIT. Max unsigned bigint is the documented workaround.
    sql += ' LIMIT 18446744073709551615';
  }
  if (hasOffset) {
    sql += ' OFFSET ?';
    bindings.push(offset);
  }
  return sql;
}

export function returningInsertSql(sql: string, dialect: SqlDialect, primaryKey = 'id'): string {
  if (!/^\s*insert\b/i.test(sql)) return sql;
  if (dialect === 'postgres') return `${sql.replace(/;?\s*$/, '')} RETURNING *`;
  if (dialect === 'mssql' && !/\boutput\b/i.test(sql)) {
    return sql.replace(/^\s*insert\s+into\s+/i, `INSERT INTO `).replace(
      /(\)\s*)values\s*/i,
      `$1 OUTPUT INSERTED.${primaryKey} VALUES `,
    );
  }
  return sql;
}
