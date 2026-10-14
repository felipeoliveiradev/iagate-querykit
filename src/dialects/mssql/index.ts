import { defineDialect, fetchNextPaging } from '../define.js';
import { makeQuoter } from '../quoting.js';
import { wrapBracket } from '../../engine/idents.js';
import { registerDialect } from '../../engine/registry.js';
import { toMssqlParams } from '../../sql/placeholders.js';

const q = makeQuoter(wrapBracket);

export const mssqlDialect = defineDialect({
  name: 'mssql',
  maxBindParams: 2100,
  capabilities: { regex: false, timezones: true, returning: true, windowFunctions: true },
  ...q,
  applyPaging: (sql, limit, offset, bindings) =>
    fetchNextPaging(sql, limit, offset, bindings, 'ORDER BY (SELECT NULL)'),
  returningInsertSql: (sql, primaryKey = 'id') => {
    if (!/^\s*insert\b/i.test(sql) || /\boutput\b/i.test(sql)) return sql;
    return sql.replace(/^\s*insert\s+into\s+/i, 'INSERT INTO ').replace(
      /(\)\s*)values\s*/i,
      `$1 OUTPUT INSERTED.${primaryKey} VALUES `,
    );
  },
  toDriverParams: (sql) => toMssqlParams(sql),
  iLikeSql: (col) => `${col} LIKE ? COLLATE SQL_Latin1_General_CP1_CI_AS`,
  jsonContains: (col, value) => ({
    sql: `EXISTS (SELECT 1 FROM OPENJSON(${col}) WHERE [value] = ?)`,
    bindings: [typeof value === 'object' && value !== null ? JSON.stringify(value) : value],
  }),
  fullText: (_t, cols, _r, query) => ({
    sql: `(${cols.map((c) => `CONTAINS(${c}, ?)`).join(' OR ')})`,
    bindings: cols.map(() => query),
  }),
  findInSet: (col) => `? IN (SELECT value FROM STRING_SPLIT(${col}, ','))`,
  arrayContains: (col) => `? IN (SELECT value FROM STRING_SPLIT(${col}, ','))`,
  whereDate: (col, date) => ({ sql: `CAST(${col} AS DATE) = CAST(? AS DATE)`, bindings: [date] }),
  whereDateRangeTz: (col, start, end, tz) => ({
    sql: `${col} AT TIME ZONE 'UTC' AT TIME ZONE ? BETWEEN ? AND ?`,
    bindings: [tz, start, end],
  }),
  radians: (expr) => `radians(${expr})`,
  beginSavepointSql: (name) => `SAVE TRANSACTION ${name}`,
  releaseSavepointSql: () => null,
  rollbackSavepointSql: (name) => `ROLLBACK TRANSACTION ${name}`,
  migrationsTableSql: () =>
    `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='querykit_migrations' and xtype='U') CREATE TABLE querykit_migrations (id NVARCHAR(255) PRIMARY KEY, applied_at DATETIME DEFAULT GETDATE())`,
  listTriggersQueries: () => [{ sql: 'SELECT name FROM sys.triggers', map: (r: any) => r.name }],
  listViewsQueries: () => [{ sql: 'SELECT name FROM sys.views', map: (r: any) => r.name }],
  ifNotExistsClause: () => '',
  ifExistsClause: () => '',
  addColumnKeyword: () => '',
  dropIndexSql: (quoted) => `DROP INDEX ${quoted}`,
  listColumnsQueries: (_quoted, raw) => [
    {
      sql: 'SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?',
      bindings: [raw],
      map: (r: any) => r.name || r.COLUMN_NAME,
    },
  ],
  createTriggerSql: (name, table, timing, event, body) => {
    const ident = q.quoteIdent(name);
    const tbl = q.quoteIdent(table);
    const clean = body.trim().replace(/;?\s*$/, '');
    return [
      `CREATE TRIGGER ${ident} ON ${tbl} ${timing === 'BEFORE' ? 'INSTEAD OF' : 'AFTER'} ${event} AS BEGIN ${clean}; END`,
    ];
  },
  currentTimestampSql: () => 'GETDATE()',
  types: {
    int: 'INT',
    bigint: 'BIGINT',
    float: 'FLOAT',
    double: 'FLOAT(53)',
    decimal: (o) => `DECIMAL(${o.precision || 10},${o.scale || 2})`,
    string: (o) => `NVARCHAR(${o.length || 255})`,
    text: 'NVARCHAR(MAX)',
    date: 'DATE',
    time: 'TIME',
    datetime: 'DATETIME2',
    timestamptz: 'DATETIMEOFFSET',
    boolean: 'BIT',
    json: 'NVARCHAR(MAX)',
    uuid: 'UNIQUEIDENTIFIER',
    binary: 'VARBINARY(MAX)',
  },
  uuidV4Sql: () => 'NEWID()',
  autoIncrementSql: (_k, opts) => ({ suffix: `IDENTITY(${opts?.start ?? 1},${opts?.increment ?? 1})` }),
});

registerDialect(mssqlDialect);
export default mssqlDialect;
