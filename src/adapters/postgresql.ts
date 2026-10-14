import type { DatabaseExecutor, QueryResult, WriteResult } from '../types.js';
import { toPostgresParams } from '../sql/placeholders.js';
import { asWrite, loadOptionalPeer } from './shared.js';
import { runNestedSavepoint } from './savepoints.js';

let pg: any;
function ensurePg() {
  if (pg) return;
  pg = loadOptionalPeer('pg', 'pg');
}

export type PostgresExecutorConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | object;
  poolSize?: number;
  pool?: any;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
};

function mapResult(res: any): QueryResult {
  const rows = res?.rows || [];
  const affectedRows = res?.rowCount;
  let lastInsertId: any;
  if (rows.length && (rows[0].id !== undefined || rows[0].ID !== undefined)) {
    lastInsertId = rows[0].id ?? rows[0].ID;
  }
  return { data: rows, affectedRows, lastInsertId };
}

export class PostgresExecutor implements DatabaseExecutor {
  public readonly dialect = 'postgres' as const;
  private pool: any;
  private ownsPool: boolean;

  constructor(config: PostgresExecutorConfig = {}) {
    ensurePg();
    if (config.pool) {
      this.pool = config.pool;
      this.ownsPool = false;
    } else {
      const { Pool } = pg;
      this.pool = new Pool({
        connectionString: config.connectionString,
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl,
        max: config.poolSize || 10,
        connectionTimeoutMillis: config.connectionTimeoutMillis ?? 30_000,
        idleTimeoutMillis: config.idleTimeoutMillis,
      });
      this.ownsPool = true;
    }
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    const text = toPostgresParams(sql);
    const res = await this.pool.query({ text, values: bindings });
    return mapResult(res);
  }

  async run(sql: string, bindings: any[] = []): Promise<WriteResult> {
    return asWrite(await this.executeQuery(sql, bindings));
  }

  async transaction<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const makeTx = (depth: number): DatabaseExecutor => {
      const tx: DatabaseExecutor = {
        dialect: 'postgres',
        executeQuery: async (sql: string, bindings: any[] = []) => {
          const text = toPostgresParams(sql);
          return mapResult(await client.query({ text, values: bindings }));
        },
        run: async (sql: string, bindings: any[] = []) =>
          asWrite(await tx.executeQuery(sql, bindings)),
        transaction: (inner) =>
          runNestedSavepoint('postgres', depth + 1, (sql) => client.query(sql), () => inner(makeTx(depth + 1))),
      };
      return tx;
    };
    try {
      await client.query('BEGIN');
      const result = await fn(makeTx(0));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool && this.pool && typeof this.pool.end === 'function') {
      await this.pool.end();
    }
  }
}
