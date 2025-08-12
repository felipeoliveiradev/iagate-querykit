import type { DatabaseExecutor, QueryResult } from '../types';

let mssql: any;
function ensureMssql() {
  if (mssql) return;
  const mocked = (globalThis as any).__vitest_mocks__?.mssql;
  if (mocked) { mssql = mocked; return; }
  try { mssql = require('mssql'); } catch { throw new Error('mssql is required: npm install mssql'); }
}

function toMssql(sql: string): { sql: string; paramNames: string[] } {
  const names: string[] = [];
  let i = 0;
  const out = sql.replace(/\?/g, () => { const name = `p${++i}`; names.push(name); return `@${name}`; });
  return { sql: out, paramNames: names };
}

export type SqlServerExecutorConfig = {
  user?: string;
  password?: string;
  server?: string;
  port?: number;
  database?: string;
  options?: Record<string, any>;
  pool?: { max?: number; min?: number };
};

export class SqlServerExecutor implements DatabaseExecutor {
  public dialect: 'mssql' = 'mssql';
  private pool: any;

  constructor(private config: SqlServerExecutorConfig = {}) {
    ensureMssql();
    this.pool = new mssql.ConnectionPool({
      user: config.user,
      password: config.password,
      server: config.server || 'localhost',
      port: config.port,
      database: config.database,
      options: { trustServerCertificate: true, ...(config.options || {}) },
      pool: { max: config.pool?.max || 10, min: config.pool?.min || 0 },
    }).connect();
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    const pool = await this.pool;
    const { sql: text, paramNames } = toMssql(sql);
    const request = pool.request();
    paramNames.forEach((name, idx) => { request.input(name, bindings[idx]); });
    const res = await request.query(text);
    const rows = res.recordset || [];
    const affectedRows = Array.isArray(res.rowsAffected) ? res.rowsAffected.reduce((a: number, b: number) => a + b, 0) : undefined;
    return { data: rows, affectedRows };
  }
} 