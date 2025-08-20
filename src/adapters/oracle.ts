import type { DatabaseExecutor, QueryResult } from '../types';
import { createRequire } from 'node:module';

let oracledb: any;
function ensureOracle() {
  if (oracledb) return;
  const mocked = (globalThis as any).__vitest_mocks__?.oracledb;
  if (mocked) { oracledb = mocked; return; }
  try { const req = createRequire(import.meta.url); oracledb = req('oracledb'); } catch { throw new Error('oracledb is required: npm install oracledb'); }
}

function toOracle(sql: string): { sql: string } {
  let i = 0;
  const out = sql.replace(/\?/g, () => `:${++i}`);
  return { sql: out };
}

export type OracleExecutorConfig = {
  user?: string;
  password?: string;
  connectString?: string;
  poolMin?: number;
  poolMax?: number;
};

export class OracleExecutor implements DatabaseExecutor {
  public dialect: 'oracle' = 'oracle';
  private pool: any;

  constructor(private config: OracleExecutorConfig = {}) {
    ensureOracle();
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
      const { sql: text } = toOracle(sql);
      const res = await conn.execute(text, bindings, { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: true });
      const rows = (res as any).rows || [];
      const affectedRows = (res as any).rowsAffected;
      const lastInsertId = (res as any).lastRowid;
      return { data: rows, affectedRows, lastInsertId };
    } finally {
      try { await conn.close(); } catch {}
    }
  }
} 