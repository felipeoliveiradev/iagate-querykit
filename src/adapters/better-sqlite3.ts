import type { DatabaseExecutor, QueryResult, WriteResult } from '../types.js';
import { isSelectLike } from '../sql/dialect.js';
import { loadOptionalPeer } from './shared.js';

export type BetterSqlite3Database = any;

export type BetterSqlite3ExecutorOptions = {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (...args: any[]) => void;
};

function loadBetterSqlite3(): any {
  return loadOptionalPeer('better-sqlite3', 'betterSqlite3');
}

export class BetterSqlite3Executor implements DatabaseExecutor {
  public readonly dialect = 'sqlite' as const;
  private db: BetterSqlite3Database;
  private ownsConnection: boolean;

  constructor(dbOrPath: string | BetterSqlite3Database, options?: BetterSqlite3ExecutorOptions) {
    if (typeof dbOrPath === 'string') {
      const Database = loadBetterSqlite3();
      this.db = new Database(dbOrPath, options);
      this.ownsConnection = true;
    } else {
      this.db = dbOrPath;
      this.ownsConnection = false;
    }
    try {
      this.db.pragma('foreign_keys = ON');
    } catch {
      /* older mocks */
    }
  }

  executeQuerySync(sql: string, bindings: any[] = []): QueryResult {
    const stmt = this.db.prepare(sql);
    if (isSelectLike(sql) || (typeof stmt.reader === 'boolean' && stmt.reader)) {
      const data = stmt.all(...bindings);
      return { data };
    }
    const info = stmt.run(...bindings);
    return { data: [], affectedRows: info.changes, lastInsertId: info.lastInsertRowid };
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    return this.executeQuerySync(sql, bindings);
  }

  runSync(sql: string, bindings: any[] = []): WriteResult {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...bindings);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async run(sql: string, bindings: any[] = []): Promise<WriteResult> {
    return this.runSync(sql, bindings);
  }

  async transaction<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  close(): void {
    if (this.ownsConnection && this.db && typeof this.db.close === 'function') {
      this.db.close();
    }
  }

  getDatabase(): BetterSqlite3Database {
    return this.db;
  }
}
