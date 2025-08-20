import type { DatabaseExecutor, QueryResult } from '../types';
import { createRequire } from 'node:module';

let mysql: any;
function ensureMysql() {
  if (mysql) return;
  const mocked = (globalThis as any).__vitest_mocks__?.mysql2;
  if (mocked) { mysql = mocked; return; }
  try { const req = createRequire(import.meta.url); mysql = req('mysql2/promise'); } catch { throw new Error('mysql2 is required: npm install mysql2'); }
}

function convertPlaceholders(sql: string): string { return sql; }

export type MysqlExecutorConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
};

export class MysqlExecutor implements DatabaseExecutor {
  public dialect: 'mysql' = 'mysql';
  private pool: any;

  constructor(private config: MysqlExecutorConfig) {
    ensureMysql();
    this.pool = mysql.createPool({
      host: config.host || '127.0.0.1',
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.connectionLimit || 10,
      decimalNumbers: true,
      namedPlaceholders: false,
    });
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<any> {
    const conv = convertPlaceholders(sql);
    const [rows, info] = await this.pool.execute(conv, bindings);
    if (/^\s*select/i.test(conv)) {
      return { data: rows } as QueryResult;
    }
    return [rows, info];
  }
} 