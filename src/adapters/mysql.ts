import type { DatabaseExecutor, QueryResult, WriteResult } from '../types.js';
import { isSelectLike } from '../sql/dialect.js';
import { createRequire } from 'node:module';

let mysql: any;
function ensureMysql() {
  if (mysql) return;
  const mocked = (globalThis as any).__vitest_mocks__?.mysql2;
  if (mocked) {
    mysql = mocked;
    return;
  }
  try {
    const req = createRequire(import.meta.url);
    mysql = req('mysql2/promise');
  } catch {
    throw new Error('mysql2 is required: npm install mysql2');
  }
}

export type MysqlExecutorConfig = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  pool?: any;
  socketPath?: string;
  ssl?: any;
};

function mapMysql(sql: string, rows: any, info: any): QueryResult {
  if (isSelectLike(sql) || Array.isArray(rows)) {
    if (Array.isArray(rows) && !Array.isArray(rows[0]) && rows !== info) {
      const looksLikeRows = Array.isArray(rows) && (rows.length === 0 || typeof rows[0] === 'object');
      if (looksLikeRows && (info === undefined || !Array.isArray(info) || isSelectLike(sql))) {
        return {
          data: rows,
          affectedRows: info?.affectedRows,
          lastInsertId: info?.insertId,
        };
      }
    }
  }
  const header = info || rows || {};
  return {
    data: Array.isArray(rows) && !header.affectedRows ? rows : [],
    affectedRows: header.affectedRows,
    lastInsertId: header.insertId,
  };
}

function asWrite(res: QueryResult): WriteResult {
  return {
    changes: res.affectedRows ?? 0,
    lastInsertRowid: (res.lastInsertId as any) ?? 0,
  };
}

export class MysqlExecutor implements DatabaseExecutor {
  public readonly dialect = 'mysql' as const;
  private pool: any;
  private ownsPool: boolean;

  constructor(config: MysqlExecutorConfig = {}) {
    ensureMysql();
    if (config.pool) {
      this.pool = config.pool;
      this.ownsPool = false;
    } else {
      this.pool = mysql.createPool({
        host: config.host || '127.0.0.1',
        port: config.port || 3306,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionLimit: config.connectionLimit || 10,
        decimalNumbers: true,
        namedPlaceholders: false,
        socketPath: config.socketPath,
        ssl: config.ssl,
      });
      this.ownsPool = true;
    }
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    const [rows, info] = await this.pool.execute(sql, bindings);
    return mapMysql(sql, rows, info);
  }

  async run(sql: string, bindings: any[] = []): Promise<WriteResult> {
    return asWrite(await this.executeQuery(sql, bindings));
  }

  async transaction<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    const tx: DatabaseExecutor = {
      dialect: 'mysql',
      executeQuery: async (sql: string, bindings: any[] = []) => {
        const [rows, info] = await conn.execute(sql, bindings);
        return mapMysql(sql, rows, info);
      },
      run: async (sql: string, bindings: any[] = []) =>
        asWrite(await tx.executeQuery(sql, bindings)),
    };
    try {
      await conn.beginTransaction();
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
      conn.release();
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool && this.pool && typeof this.pool.end === 'function') {
      await this.pool.end();
    }
  }
}
