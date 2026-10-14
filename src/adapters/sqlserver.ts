import type { DatabaseExecutor, QueryResult, WriteResult } from '../types.js';
import { toMssqlParams } from '../sql/placeholders.js';
import { createRequire } from 'node:module';

let mssql: any;
function ensureMssql() {
  if (mssql) return;
  const mocked = (globalThis as any).__vitest_mocks__?.mssql;
  if (mocked) {
    mssql = mocked;
    return;
  }
  try {
    const req = createRequire(import.meta.url);
    mssql = req('mssql');
  } catch {
    throw new Error('mssql is required: npm install mssql');
  }
}

export type SqlServerExecutorConfig = {
  user?: string;
  password?: string;
  server?: string;
  port?: number;
  database?: string;
  options?: Record<string, any>;
  pool?: { max?: number; min?: number } | any;
};

function mapMssql(res: any): QueryResult {
  const rows = res?.recordset || [];
  const affectedRows = Array.isArray(res?.rowsAffected)
    ? res.rowsAffected.reduce((a: number, b: number) => a + b, 0)
    : res?.rowsAffected;
  let lastInsertId: any;
  if (rows.length && (rows[0].id !== undefined || rows[0].ID !== undefined)) {
    lastInsertId = rows[0].id ?? rows[0].ID;
  }
  return { data: rows, affectedRows, lastInsertId };
}

function asWrite(res: QueryResult): WriteResult {
  return {
    changes: res.affectedRows ?? 0,
    lastInsertRowid: (res.lastInsertId as any) ?? 0,
  };
}

function bindRequest(pool: any, paramNames: string[], bindings: any[]): any {
  const request = pool.request();
  paramNames.forEach((name, idx) => {
    request.input(name, bindings[idx]);
  });
  return request;
}

export class SqlServerExecutor implements DatabaseExecutor {
  public readonly dialect = 'mssql' as const;
  private poolPromise: Promise<any>;
  private ownsPool: boolean;

  constructor(config: SqlServerExecutorConfig = {}) {
    ensureMssql();
    if (config.pool && typeof config.pool.request === 'function') {
      this.poolPromise = Promise.resolve(config.pool);
      this.ownsPool = false;
    } else {
      this.poolPromise = new mssql.ConnectionPool({
        user: config.user,
        password: config.password,
        server: config.server || 'localhost',
        port: config.port,
        database: config.database,
        options: { trustServerCertificate: true, ...(config.options || {}) },
        pool: { max: (config.pool as any)?.max || 10, min: (config.pool as any)?.min || 0 },
      }).connect();
      this.ownsPool = true;
    }
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    const pool = await this.poolPromise;
    const { sql: text, paramNames } = toMssqlParams(sql);
    const request = bindRequest(pool, paramNames, bindings);
    const res = await request.query(text);
    return mapMssql(res);
  }

  async run(sql: string, bindings: any[] = []): Promise<WriteResult> {
    return asWrite(await this.executeQuery(sql, bindings));
  }

  async transaction<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    const pool = await this.poolPromise;
    const transaction = new mssql.Transaction(pool);
    await transaction.begin();
    const tx: DatabaseExecutor = {
      dialect: 'mssql',
      executeQuery: async (sql: string, bindings: any[] = []) => {
        const { sql: text, paramNames } = toMssqlParams(sql);
        const request = new mssql.Request(transaction);
        paramNames.forEach((name, idx) => {
          request.input(name, bindings[idx]);
        });
        return mapMssql(await request.query(text));
      },
      run: async (sql: string, bindings: any[] = []) =>
        asWrite(await tx.executeQuery(sql, bindings)),
    };
    try {
      const result = await fn(tx);
      await transaction.commit();
      return result;
    } catch (err) {
      try {
        await transaction.rollback();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this.ownsPool) return;
    const pool = await this.poolPromise.catch(() => null);
    if (pool && typeof pool.close === 'function') await pool.close();
  }
}
