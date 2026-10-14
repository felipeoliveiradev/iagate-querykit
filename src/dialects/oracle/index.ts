import { defineDialect, fetchNextPaging } from '../define.js';
import { makeQuoter } from '../quoting.js';
import { wrapDouble } from '../../engine/idents.js';
import { registerDialect } from '../../engine/registry.js';
import { toOracleParams } from '../../sql/placeholders.js';

const q = makeQuoter(wrapDouble);

export const oracleDialect = defineDialect({
  name: 'oracle',
  maxBindParams: 65535,
  capabilities: { regex: true, timezones: true, returning: false },
  ...q,
  applyPaging: (sql, limit, offset, bindings) =>
    fetchNextPaging(sql, limit, offset, bindings, 'ORDER BY 1'),
  toDriverParams: (sql) => ({ sql: toOracleParams(sql) }),
  iLikeSql: (col) => `UPPER(${col}) LIKE UPPER(?)`,
  jsonContains: (col, value) => ({
    sql: `JSON_EXISTS(${col}, '$[*]?(@ == $v)' PASSING ? AS "v")`,
    bindings: [typeof value === 'object' && value !== null ? JSON.stringify(value) : value],
  }),
  fullText: (_t, cols, _r, query) => ({
    sql: `(${cols.map((c) => `CONTAINS(${c}, ?) > 0`).join(' OR ')})`,
    bindings: cols.map(() => query),
  }),
  findInSet: (col) => `? IN (SELECT COLUMN_VALUE FROM TABLE(SYS.ODCIVARCHAR2LIST(${col})))`,
  arrayContains: (col) => `? IN (SELECT COLUMN_VALUE FROM TABLE(SYS.ODCIVARCHAR2LIST(${col})))`,
  whereDate: (col, date) => ({ sql: `TRUNC(${col}) = TRUNC(?)`, bindings: [date] }),
  whereDateRangeTz: (col, start, end, tz) => ({
    sql: `FROM_TZ(${col}, 'UTC') AT TIME ZONE ? BETWEEN ? AND ?`,
    bindings: [tz, start, end],
  }),
  whereRegex: (col, pattern, flags) => ({
    sql: `REGEXP_LIKE(${col}, ?, ?)`,
    bindings: [pattern, flags || 'c'],
  }),
  radians: (expr) => `radians(${expr})`,
  releaseSavepointSql: () => null,
  migrationsTableSql: () =>
    `BEGIN EXECUTE IMMEDIATE 'CREATE TABLE querykit_migrations (id VARCHAR2(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;`,
  listTriggersQueries: () => [
    { sql: 'SELECT TRIGGER_NAME AS name FROM USER_TRIGGERS', map: (r: any) => r.name },
  ],
  listViewsQueries: () => [
    { sql: 'SELECT VIEW_NAME AS name FROM USER_VIEWS', map: (r: any) => r.name },
  ],
  listColumnsQueries: (_quoted, raw) => [
    {
      sql: 'SELECT COLUMN_NAME AS name FROM USER_TAB_COLUMNS WHERE TABLE_NAME = ?',
      bindings: [String(raw).toUpperCase()],
      map: (r: any) => r.name || r.COLUMN_NAME,
    },
  ],
  createTriggerSql: (name, table, timing, event, body) => {
    const ident = q.quoteIdent(name);
    const tbl = q.quoteIdent(table);
    const clean = body.trim().replace(/;?\s*$/, '');
    return [
      `CREATE OR REPLACE TRIGGER ${ident} ${timing === 'INSTEAD OF' ? 'BEFORE' : timing} ${event} ON ${tbl} FOR EACH ROW BEGIN ${clean}; END;`,
    ];
  },
  dropTriggerSql: (name) =>
    `BEGIN EXECUTE IMMEDIATE 'DROP TRIGGER ${q.quoteIdent(name)}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -4080 THEN RAISE; END IF; END;`,
  dropViewSql: (name) =>
    `BEGIN EXECUTE IMMEDIATE 'DROP VIEW ${q.quoteIdent(name)}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`,
  dropTableSql: (quoted) =>
    `BEGIN EXECUTE IMMEDIATE 'DROP TABLE ${quoted}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`,
  dropIndexSql: (quoted) =>
    `BEGIN EXECUTE IMMEDIATE 'DROP INDEX ${quoted}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1418 THEN RAISE; END IF; END;`,
  ifNotExistsClause: () => '',
  ifExistsClause: () => '',
  addColumnKeyword: () => '',
  types: {
    int: 'NUMBER',
    bigint: 'NUMBER(19)',
    float: 'BINARY_FLOAT',
    double: 'BINARY_DOUBLE',
    decimal: (o) => `NUMBER(${o.precision || 10},${o.scale || 2})`,
    string: (o) => `VARCHAR2(${o.length || 255})`,
    text: 'CLOB',
    date: 'DATE',
    time: 'VARCHAR2(20)',
    datetime: 'TIMESTAMP',
    timestamptz: 'TIMESTAMP WITH TIME ZONE',
    boolean: 'NUMBER(1)',
    json: 'CLOB',
    uuid: 'VARCHAR2(36)',
    binary: 'BLOB',
  },
  uuidV4Sql: () => 'LOWER(RAWTOHEX(SYS_GUID()))',
  autoIncrementSql: (_k, opts) => {
    const m = opts?.mode === 'always' ? 'ALWAYS' : 'BY DEFAULT';
    return { suffix: `GENERATED ${m} AS IDENTITY` };
  },
});

registerDialect(oracleDialect);
export default oracleDialect;
