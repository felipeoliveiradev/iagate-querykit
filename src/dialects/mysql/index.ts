import { defineDialect, limitOffsetPaging } from '../define.js';
import { makeQuoter } from '../quoting.js';
import { wrapBacktick } from '../../engine/idents.js';
import { registerDialect } from '../../engine/registry.js';
import { normalizeBinding } from '../../sql/bindings.js';

const q = makeQuoter(wrapBacktick);

export const mysqlDialect = defineDialect({
  name: 'mysql',
  maxBindParams: 65535,
  capabilities: { regex: true, timezones: true, windowFunctions: true },
  ...q,
  applyPaging: (sql, limit, offset, bindings) =>
    limitOffsetPaging(sql, limit, offset, bindings, { dummyLimit: '18446744073709551615' }),
  iLikeSql: (col) => `${col} LIKE ? COLLATE utf8_general_ci`,
  jsonContains: (col, value) => ({
    sql: `JSON_CONTAINS(${col}, ?)`,
    bindings: [typeof value === 'string' ? value : JSON.stringify(value)],
  }),
  fullText: (_t, cols, _r, query) => ({
    sql: `MATCH(${cols.join(', ')}) AGAINST(? IN NATURAL LANGUAGE MODE)`,
    bindings: [query],
  }),
  findInSet: (col) => `FIND_IN_SET(?, ${col}) > 0`,
  arrayContains: (col) => `FIND_IN_SET(?, ${col}) > 0`,
  whereDate: (col, date) => ({ sql: `DATE(${col}) = DATE(?)`, bindings: [date] }),
  whereDateRangeTz: (col, start, end, tz) => ({
    sql: `CONVERT_TZ(${col}, 'UTC', ?) BETWEEN ? AND ?`,
    bindings: [tz, start, end],
  }),
  whereRegex: (col, pattern, flags) => ({
    sql: String(flags || '').toLowerCase().includes('i') ? `${col} REGEXP ?` : `${col} REGEXP BINARY ?`,
    bindings: [pattern],
  }),
  radians: (expr) => `radians(${expr})`,
  migrationsTableSql: () =>
    `CREATE TABLE IF NOT EXISTS querykit_migrations (id VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  listTriggersQueries: () => [
    { sql: 'SELECT TRIGGER_NAME AS name FROM INFORMATION_SCHEMA.TRIGGERS', map: (r: any) => r.name },
  ],
  listViewsQueries: () => [
    { sql: "SHOW FULL TABLES WHERE TABLE_TYPE = 'VIEW'", map: (r: any) => Object.values(r)[0] as string },
  ],
  listColumnsQueries: (quoted) => [
    { sql: `SHOW COLUMNS FROM ${quoted}`, map: (r: any) => r.Field || r.field },
  ],
  createTriggerSql: (name, table, timing, event, body) => {
    const ident = q.quoteIdent(name);
    const tbl = q.quoteIdent(table);
    const clean = body.trim().replace(/;?\s*$/, '');
    return [
      `CREATE TRIGGER ${ident} ${timing === 'INSTEAD OF' ? 'BEFORE' : timing} ${event} ON ${tbl} FOR EACH ROW BEGIN ${clean}; END`,
    ];
  },
  types: {
    int: 'INT',
    bigint: 'BIGINT',
    float: 'FLOAT',
    double: 'DOUBLE',
    decimal: (o) => `DECIMAL(${o.precision || 10},${o.scale || 2})`,
    string: (o) => `VARCHAR(${o.length || 255})`,
    text: 'TEXT',
    date: 'DATE',
    time: 'TIME',
    datetime: 'DATETIME',
    timestamptz: 'TIMESTAMP',
    boolean: 'TINYINT(1)',
    json: 'JSON',
    uuid: 'CHAR(36)',
    binary: 'BLOB',
  },
  uuidV4Sql: () => 'UUID()',
  autoIncrementSql: () => ({ suffix: 'AUTO_INCREMENT' }),
  bind: (value) => {
    const bound = normalizeBinding(value);
    if (typeof bound === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(bound)) {
      const d = new Date(bound);
      if (!Number.isNaN(d.getTime())) return d.toISOString().replace('T', ' ').replace('Z', '');
    }
    return bound;
  },
});

registerDialect(mysqlDialect);
export default mysqlDialect;
