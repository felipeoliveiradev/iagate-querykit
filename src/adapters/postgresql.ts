import type { DatabaseExecutor, QueryResult } from '../types';
import { createRequire } from 'node:module';

let pg: any;
function ensurePg() {
  if (pg) return;
  const mocked = (globalThis as any).__vitest_mocks__?.pg;
  if (mocked) { pg = mocked; return; }
  try { const req = createRequire(import.meta.url); pg = req('pg'); } catch { throw new Error('pg is required: npm install pg'); }
}

function toPgParams(sql: string): { sql: string } {
  let index = 0;
  const out = sql.replace(/\?/g, () => `$${++index}`);
  return { sql: out };
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
};

export class PostgresExecutor implements DatabaseExecutor {
  public dialect: 'postgres' = 'postgres';
  private pool: any;

  constructor(private config: PostgresExecutorConfig = {}) {
    ensurePg();
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
    });
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    const { sql: text } = toPgParams(sql);
    const res = await this.pool.query({ text, values: bindings });
    return { data: res.rows, affectedRows: (res as any).rowCount };
  }
} 