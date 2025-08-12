import type { DatabaseExecutor, QueryResult } from '../types';

export type BetterSqlite3Database = any;

export class BetterSqlite3Executor implements DatabaseExecutor {
  private db: BetterSqlite3Database;

  constructor(dbFilePath: string) {
    const mocked = (globalThis as any).__vitest_mocks__?.betterSqlite3;
    /* c8 ignore next */
    const mod = mocked || require('better-sqlite3');
    this.db = new mod(dbFilePath);
  }

  executeQuerySync(sql: string, bindings: any[] = []): QueryResult {
    const stmt = this.db.prepare(sql);
    if (/^select\s/i.test(sql)) {
      const data = stmt.all(...bindings);
      return { data };
    }
    const info = stmt.run(...bindings);
    return { data: [], affectedRows: info.changes, lastInsertId: info.lastInsertRowid };
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    return this.executeQuerySync(sql, bindings);
  }

  runSync(sql: string, bindings: any[] = []) {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...bindings);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
} 