import type { DatabaseExecutor, QueryResult, WriteResult } from '../types.js';
import { isSelectLike } from '../sql/dialect.js';
import { loadOptionalPeer } from './shared.js';
import { hydrateRows, hydrateInteger } from '../engine/hydrate.js';
import { runDriver, runDriverSync } from './driver-wrap.js';

export type BetterSqlite3Database = any;

export type BetterSqlite3ExecutorOptions = {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (...args: any[]) => void;
  /** When true (default), integers that do not fit in JS number stay BigInt. */
  safeIntegers?: boolean;
};

function loadBetterSqlite3(): any {
  return loadOptionalPeer('better-sqlite3', 'betterSqlite3');
}

export class BetterSqlite3Executor implements DatabaseExecutor {
  public readonly dialect = 'sqlite' as const;
  private db: BetterSqlite3Database;
  private ownsConnection: boolean;
  private txDepth = 0;

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
    if (options?.safeIntegers !== false && typeof this.db.defaultSafeIntegers === 'function') {
      try {
        this.db.defaultSafeIntegers(true);
      } catch {
        /* mocks */
      }
    }
    this.installMathHelpers();
  }

  /** Stock SQLite has no acos/cos/sin/radians — required by whereNearby. */
  private installMathHelpers(): void {
    if (typeof this.db?.function !== 'function') return;
    const defs: Array<[string, (n: number) => number]> = [
      ['acos', Math.acos],
      ['cos', Math.cos],
      ['sin', Math.sin],
      ['radians', (x) => (Number(x) * Math.PI) / 180],
    ];
    for (const [name, fn] of defs) {
      try {
        this.db.function(name, { deterministic: true }, (x: unknown) => fn(Number(x)));
      } catch {
        /* already registered on a wrapped Database */
      }
    }
  }

  executeQuerySync(sql: string, bindings: any[] = []): QueryResult {
    return runDriverSync(this.dialect, sql, bindings, () => {
      const stmt = this.db.prepare(sql);
      if (isSelectLike(sql) || (typeof stmt.reader === 'boolean' && stmt.reader)) {
        const data = hydrateRows(stmt.all(...bindings));
        return { data };
      }
      const info = stmt.run(...bindings);
      return {
        data: [],
        affectedRows: info.changes,
        lastInsertId: hydrateInteger(info.lastInsertRowid) as number | bigint,
      };
    });
  }

  async executeQuery(sql: string, bindings: any[] = []): Promise<QueryResult> {
    return runDriver(this.dialect, sql, bindings, () => this.executeQuerySync(sql, bindings));
  }

  runSync(sql: string, bindings: any[] = []): WriteResult {
    return runDriverSync(this.dialect, sql, bindings, () => {
      const stmt = this.db.prepare(sql);
      const info = stmt.run(...bindings);
      return {
        changes: info.changes,
        lastInsertRowid: hydrateInteger(info.lastInsertRowid) as number | bigint,
      };
    });
  }

  async run(sql: string, bindings: any[] = []): Promise<WriteResult> {
    return this.runSync(sql, bindings);
  }

  async transaction<T>(fn: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    const depth = this.txDepth++;
    const sp = `qk_sp_${depth}`;
    try {
      this.db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      const result = await fn(this);
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (err) {
      try {
        this.db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${sp}`);
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      this.txDepth--;
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
