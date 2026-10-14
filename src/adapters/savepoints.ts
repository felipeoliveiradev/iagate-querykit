import type { SqlDialect } from '../sql/dialect.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function savepointName(depth: number): string {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error('savepoint depth must be a non-negative integer');
  }
  return `qk_sp_${depth}`;
}

function assertSp(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe savepoint name '${name}'`);
  return name;
}

/** BEGIN a nested savepoint (outer transaction must already be open). */
export function beginSavepointSql(dialect: SqlDialect, name: string): string {
  const n = assertSp(name);
  if (dialect === 'mssql') return `SAVE TRANSACTION ${n}`;
  return `SAVEPOINT ${n}`;
}

/** Release is a no-op on MSSQL / Oracle (commit of the outer tx is enough). */
export function releaseSavepointSql(dialect: SqlDialect, name: string): string | null {
  if (dialect === 'mssql' || dialect === 'oracle') return null;
  return `RELEASE SAVEPOINT ${assertSp(name)}`;
}

export function rollbackSavepointSql(dialect: SqlDialect, name: string): string {
  const n = assertSp(name);
  if (dialect === 'mssql') return `ROLLBACK TRANSACTION ${n}`;
  return `ROLLBACK TO SAVEPOINT ${n}`;
}

export async function runNestedSavepoint<T>(
  dialect: SqlDialect,
  depth: number,
  execSql: (sql: string) => Promise<void> | void,
  fn: () => Promise<T>,
): Promise<T> {
  const name = savepointName(depth);
  await execSql(beginSavepointSql(dialect, name));
  try {
    const result = await fn();
    const release = releaseSavepointSql(dialect, name);
    if (release) await execSql(release);
    return result;
  } catch (err) {
    try {
      await execSql(rollbackSavepointSql(dialect, name));
    } catch {
      /* ignore */
    }
    throw err;
  }
}
