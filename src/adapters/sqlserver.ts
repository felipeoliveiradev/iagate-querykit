import type { DatabaseExecutor, QueryResult, WriteResult } from '../types.js';
import { asWrite, loadOptionalPeer } from './shared.js';
import { runNestedSavepoint } from './savepoints.js';
import { mapBindings, runDriver, toNativeSql } from './driver-wrap.js';
import { hydrateRows } from '../engine/hydrate.js';

let mssql: any;
function ensureMssql() {
  if (mssql) return;
  mssql = loadOptionalPeer('mssql', 'mssql');
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
  const rows = hydrateRows(res?.recordset || []);
  const affectedRows = Array.isArray(res?.rowsAffected)
    ? res.rowsAffected.reduce((a: number, b: number) => a + b, 0)
    : res?.rowsAffected;
  let lastInsertId: any;
  if (rows.length && (rows[0].id !== undefined || rows[0].ID !== undefined)) {
    lastInsertId = rows[0].id ?? rows[0].ID;
  }
  return { data: rows, affectedRows, lastInsertId };
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
    return runDriver(this.dialect, sql, bindings, async () => {
      const pool = await this.poolPromise;
      const { sql: text, paramNames } = toNativeSql(this.dialect, sql);
      const request = bindRequest(pool, paramNames || [], mapBindings(this.dialect, bindings));
      const res = await request.query(text);
      return mapMssql(res);
    });
  }

  async run(sql: string, bindings: any[] = []): Promise<WriteResult> {
    return asWrite(await this.executeQuery(sql, bindings));
  }

  async transaction<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    const pool = await this.poolPromise;
    const transaction = new mssql.Transaction(pool);
    await transaction.begin();
    const execOnTx = async (sql: string, bindings: any[] = []) =>
      runDriver('mssql', sql, bindings, async () => {
        const { sql: text, paramNames } = toNativeSql('mssql', sql);
        const request = new mssql.Request(transaction);
        const values = mapBindings('mssql', bindings);
        (paramNames || []).forEach((name, idx) => {
          request.input(name, values[idx]);
        });
        return mapMssql(await request.query(text));
      });
    const makeTx = (depth: number): DatabaseExecutor => {
      const tx: DatabaseExecutor = {
        dialect: 'mssql',
        executeQuery: execOnTx,
        run: async (sql: string, bindings: any[] = []) => asWrite(await execOnTx(sql, bindings)),
        transaction: (inner) =>
          runNestedSavepoint(
            'mssql',
            depth + 1,
            async (sql) => {
              await execOnTx(sql, []);
            },
            () => inner(makeTx(depth + 1)),
          ),
      };
      return tx;
    };
    try {
      const result = await fn(makeTx(0));
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
