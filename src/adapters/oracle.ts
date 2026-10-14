import type { DatabaseExecutor, QueryResult, WriteResult } from '../types.js';
import { toOracleParams } from '../sql/placeholders.js';
import { asWrite, loadOptionalPeer } from './shared.js';

let oracledb: any;
function ensureOracle() {
  if (oracledb) return;
  oracledb = loadOptionalPeer('oracledb', 'oracledb');
}

export type OracleExecutorConfig = {
  user?: string;
  password?: string;
  connectString?: string;
  poolMin?: number;
  poolMax?: number;
  pool?: any;
};

function mapOracle(res: any): QueryResult {
  const rows = res?.rows || [];
  return {
    data: rows,
    affectedRows: res?.rowsAffected,
    lastInsertId: res?.lastRowid,
  };
}

export class OracleExecutor implements DatabaseExecutor {
  public readonly dialect = 'oracle' as const;
  private pool: any;
  private config: OracleExecutorConfig;
  private ownsPool: boolean;

  constructor(config: OracleExecutorConfig = {}) {
    ensureOracle();
    this.config = config;
    this.pool = config.pool;
    this.ownsPool = !config.pool;
  }

  private async getPool() {
    if (!this.pool) {
      this.pool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: this.config.connectString,
        poolMin: this.config.poolMin || 0,
        poolMax: this.config.poolMax || 10,
      });
    }
    return this.pool;
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      const text = toOracleParams(sql);
      const res = await conn.execute(text, bindings, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });
      return mapOracle(res);
    } finally {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }

  async run(sql: string, bindings: any[] = []): Promise<WriteResult> {
    return asWrite(await this.executeQuery(sql, bindings));
  }

  async transaction<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    const tx: DatabaseExecutor = {
      dialect: 'oracle',
      executeQuery: async (sql: string, bindings: any[] = []) => {
        const text = toOracleParams(sql);
        const res = await conn.execute(text, bindings, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          autoCommit: false,
        });
        return mapOracle(res);
      },
      run: async (sql: string, bindings: any[] = []) =>
        asWrite(await tx.executeQuery(sql, bindings)),
    };
    try {
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool && this.pool && typeof this.pool.close === 'function') {
      await this.pool.close(0);
    }
  }
}
