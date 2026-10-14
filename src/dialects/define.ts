import type { CatalogQuery, ColumnTypeName, Dialect, DialectCapabilities, FullTextOptions, SqlFragment } from '../engine/dialect.js';
import { normalizeBinding } from '../sql/bindings.js';
import { hydrateInteger } from '../engine/hydrate.js';
import { normalizeDriverCode } from '../engine/errors.js';
import { fts5MatchQuery } from '../sql/fts5.js';

export type DialectHooks = {
  name: string;
  maxBindParams: number;
  capabilities?: DialectCapabilities;
  quoteIdent: (name: string) => string;
  quoteTableRef: (ref: string) => string;
  quoteSelectItem: (item: string) => string;
  applyPaging?: Dialect['applyPaging'];
  returningInsertSql?: Dialect['returningInsertSql'];
  toDriverParams?: Dialect['toDriverParams'];
  iLikeSql?: Dialect['iLikeSql'];
  jsonContains?: Dialect['jsonContains'];
  fullText?: Dialect['fullText'];
  findInSet?: Dialect['findInSet'];
  arrayContains?: Dialect['arrayContains'];
  whereDate?: Dialect['whereDate'];
  whereDateRangeTz?: Dialect['whereDateRangeTz'];
  whereRegex?: Dialect['whereRegex'];
  radians?: Dialect['radians'];
  beginSavepointSql?: Dialect['beginSavepointSql'];
  releaseSavepointSql?: Dialect['releaseSavepointSql'];
  rollbackSavepointSql?: Dialect['rollbackSavepointSql'];
  migrationsTableSql?: Dialect['migrationsTableSql'];
  listTriggersQueries?: Dialect['listTriggersQueries'];
  listViewsQueries?: Dialect['listViewsQueries'];
  listColumnsQueries?: Dialect['listColumnsQueries'];
  createTriggerSql?: Dialect['createTriggerSql'];
  dropTriggerSql?: Dialect['dropTriggerSql'];
  dropViewSql?: Dialect['dropViewSql'];
  dropTableSql?: Dialect['dropTableSql'];
  dropIndexSql?: Dialect['dropIndexSql'];
  ifNotExistsClause?: Dialect['ifNotExistsClause'];
  ifExistsClause?: Dialect['ifExistsClause'];
  addColumnKeyword?: Dialect['addColumnKeyword'];
  columnType?: Dialect['columnType'];
  currentTimestampSql?: Dialect['currentTimestampSql'];
  uuidV4Sql?: Dialect['uuidV4Sql'];
  autoIncrementSql?: Dialect['autoIncrementSql'];
  bind?: Dialect['bind'];
  hydrate?: Dialect['hydrate'];
  types?: Partial<Record<ColumnTypeName, string | ((opts: { length?: number; precision?: number; scale?: number }) => string)>>;
};

export function limitOffsetPaging(
  sql: string,
  limit: number | undefined,
  offset: number | undefined,
  bindings: unknown[],
  opts: { dummyLimit?: string } = {},
): string {
  const hasLimit = typeof limit === 'number';
  const hasOffset = typeof offset === 'number';
  if (!hasLimit && !hasOffset) return sql;
  if (hasLimit) {
    sql += ' LIMIT ?';
    bindings.push(limit);
  } else if (hasOffset && opts.dummyLimit) {
    sql += ` LIMIT ${opts.dummyLimit}`;
  }
  if (hasOffset) {
    sql += ' OFFSET ?';
    bindings.push(offset);
  }
  return sql;
}

export function fetchNextPaging(
  sql: string,
  limit: number | undefined,
  offset: number | undefined,
  bindings: unknown[],
  orderFallback: string,
): string {
  const hasLimit = typeof limit === 'number';
  const hasOffset = typeof offset === 'number';
  if (!hasLimit && !hasOffset) return sql;
  let out = sql;
  if (!/\border\s+by\b/i.test(out)) out += ` ${orderFallback}`;
  const off = hasOffset ? offset! : 0;
  const lim = hasLimit ? limit! : 0;
  if (hasOffset && hasLimit) {
    out += ' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY';
    bindings.push(off, lim);
  } else if (hasOffset) {
    out += ' OFFSET ? ROWS';
    bindings.push(off);
  } else {
    out += ' OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY';
    bindings.push(lim);
  }
  return out;
}

function defaultColumnType(
  types: DialectHooks['types'],
  kind: ColumnTypeName,
  opts?: { length?: number; precision?: number; scale?: number },
): string {
  const spec = types?.[kind];
  if (typeof spec === 'function') return spec(opts || {});
  if (typeof spec === 'string') return spec;
  return 'TEXT';
}

export function defineDialect(hooks: DialectHooks): Dialect {
  const q = hooks;
  const types = hooks.types || {};
  const dialect: Dialect = {
    name: hooks.name,
    maxBindParams: hooks.maxBindParams,
    capabilities: {
      fullText: true,
      json: true,
      savepoints: true,
      ...(hooks.capabilities || {}),
    },
    quoteIdent: q.quoteIdent,
    quoteTableRef: q.quoteTableRef,
    quoteSelectItem: q.quoteSelectItem,
    applyPaging:
      hooks.applyPaging ||
      ((sql, limit, offset, bindings) => limitOffsetPaging(sql, limit, offset, bindings)),
    returningInsertSql: hooks.returningInsertSql || ((sql) => sql),
    toDriverParams: hooks.toDriverParams || ((sql) => ({ sql })),
    iLikeSql: hooks.iLikeSql || ((col) => `LOWER(${col}) LIKE LOWER(?)`),
    jsonContains:
      hooks.jsonContains ||
      ((col, value) => {
        const jsonText = typeof value === 'string' ? value : JSON.stringify(value);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          const keys = Object.keys(value);
          if (!keys.length) return { sql: `json_valid(${col})`, bindings: [] };
          return {
            sql: keys.map(() => `json_extract(${col}, ?) = ?`).join(' AND '),
            bindings: keys.flatMap((k) => [`$.${k}`, (value as Record<string, unknown>)[k]]),
          };
        }
        return {
          sql: `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?)`,
          bindings: [Array.isArray(value) ? jsonText : value],
        };
      }),
    fullText:
      hooks.fullText ||
      ((table, cols, raw, query, opts?: FullTextOptions) => {
        if (opts?.mode === 'like') {
          return {
            sql: `(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`,
            bindings: cols.map(() => `%${query}%`),
          };
        }
        return { sql: `${table} MATCH ?`, bindings: [fts5MatchQuery(raw, query)] };
      }),
    findInSet:
      hooks.findInSet ||
      ((col) => `(',' || REPLACE(${col}, ' ', '') || ',') LIKE ('%,' || ? || ',%')`),
    arrayContains: hooks.arrayContains || hooks.findInSet ||
      ((col) => `(',' || REPLACE(${col}, ' ', '') || ',') LIKE ('%,' || ? || ',%')`),
    whereDate:
      hooks.whereDate ||
      ((col, date) => {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return { sql: `${col} BETWEEN ? AND ?`, bindings: [start, end] };
      }),
    whereDateRangeTz:
      hooks.whereDateRangeTz ||
      ((col, start, end) => ({ sql: `${col} BETWEEN ? AND ?`, bindings: [start, end] })),
    whereRegex:
      hooks.whereRegex ||
      ((col, pattern) => {
        const likePattern = pattern
          .replace(/^\^/, '')
          .replace(/\$$/, '')
          .replace(/[.*+?^${}()|[\]\\]/g, '%');
        return { sql: `${col} LIKE ?`, bindings: [likePattern.includes('%') ? likePattern : `%${likePattern}%`] };
      }),
    radians: hooks.radians || ((expr) => `(${expr} * 0.017453292519943295)`),
    beginSavepointSql: hooks.beginSavepointSql || ((name) => `SAVEPOINT ${name}`),
    releaseSavepointSql: hooks.releaseSavepointSql || ((name) => `RELEASE SAVEPOINT ${name}`),
    rollbackSavepointSql: hooks.rollbackSavepointSql || ((name) => `ROLLBACK TO SAVEPOINT ${name}`),
    migrationsTableSql:
      hooks.migrationsTableSql ||
      (() =>
        `CREATE TABLE IF NOT EXISTS querykit_migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`),
    listTriggersQueries:
      hooks.listTriggersQueries ||
      (() => [{ sql: "SELECT name FROM sqlite_master WHERE type='trigger'", map: (r: any) => r.name }]),
    listViewsQueries:
      hooks.listViewsQueries ||
      (() => [{ sql: "SELECT name FROM sqlite_master WHERE type='view'", map: (r: any) => r.name }]),
    listColumnsQueries:
      hooks.listColumnsQueries ||
      ((quoted) => [{ sql: `PRAGMA table_info(${quoted})`, map: (r: any) => r.name }]),
    createTriggerSql:
      hooks.createTriggerSql ||
      ((name, table, timing, event, body) => {
        const ident = q.quoteIdent(name);
        const tbl = q.quoteIdent(table);
        const clean = body.trim().replace(/;?\s*$/, '');
        return [
          `CREATE TRIGGER IF NOT EXISTS ${ident} ${timing} ${event} ON ${tbl} FOR EACH ROW BEGIN ${clean}; END`,
        ];
      }),
    dropTriggerSql: hooks.dropTriggerSql || ((name) => `DROP TRIGGER IF EXISTS ${q.quoteIdent(name)}`),
    dropViewSql: hooks.dropViewSql || ((name) => `DROP VIEW IF EXISTS ${q.quoteIdent(name)}`),
    dropTableSql: hooks.dropTableSql || ((quoted) => `DROP TABLE IF EXISTS ${quoted}`),
    dropIndexSql: hooks.dropIndexSql || ((quoted) => `DROP INDEX IF EXISTS ${quoted}`),
    ifNotExistsClause: hooks.ifNotExistsClause || (() => 'IF NOT EXISTS '),
    ifExistsClause: hooks.ifExistsClause || (() => 'IF EXISTS '),
    addColumnKeyword: hooks.addColumnKeyword || (() => 'COLUMN '),
    columnType: hooks.columnType || ((kind, opts) => defaultColumnType(types, kind, opts)),
    currentTimestampSql: hooks.currentTimestampSql || (() => 'CURRENT_TIMESTAMP'),
    uuidV4Sql: hooks.uuidV4Sql || (() => 'NULL'),
    autoIncrementSql: hooks.autoIncrementSql,
    bind: hooks.bind || ((value) => normalizeBinding(value)),
    hydrate: hooks.hydrate || ((value) => hydrateInteger(value)),
    mapErrorCode: (err) => normalizeDriverCode(err),
  };
  return dialect;
}

export function likeFullText(cols: string[], query: string): SqlFragment {
  return {
    sql: `(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`,
    bindings: cols.map(() => `%${query}%`),
  };
}

export function fallbackCatalogs(): { triggers: CatalogQuery[]; views: CatalogQuery[] } {
  return {
    triggers: [
      { sql: "SELECT name FROM sqlite_master WHERE type='trigger'", map: (r: any) => r.name },
      { sql: 'SELECT TRIGGER_NAME AS name FROM INFORMATION_SCHEMA.TRIGGERS', map: (r: any) => r.name },
      { sql: 'SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal', map: (r: any) => r.tgname || r.name },
      { sql: 'SELECT name FROM sys.triggers', map: (r: any) => r.name },
      { sql: 'SELECT TRIGGER_NAME AS name FROM USER_TRIGGERS', map: (r: any) => r.name },
    ],
    views: [
      { sql: "SELECT name FROM sqlite_master WHERE type='view'", map: (r: any) => r.name },
      { sql: "SHOW FULL TABLES WHERE TABLE_TYPE = 'VIEW'", map: (r: any) => Object.values(r)[0] as string },
      { sql: 'SELECT table_name FROM information_schema.views WHERE table_schema = current_schema()', map: (r: any) => r.table_name },
      { sql: 'SELECT name FROM sys.views', map: (r: any) => r.name },
      { sql: 'SELECT VIEW_NAME AS name FROM USER_VIEWS', map: (r: any) => r.name },
    ],
  };
}
