import { defineDialect, limitOffsetPaging } from '../define.js';
import { makeQuoter } from '../quoting.js';
import { wrapDouble } from '../../engine/idents.js';
import { registerDialect } from '../../engine/registry.js';
import { fts5MatchQuery } from '../../sql/fts5.js';
import { likeFullText } from '../define.js';

const q = makeQuoter(wrapDouble);

export const sqliteDialect = defineDialect({
  name: 'sqlite',
  maxBindParams: 999,
  capabilities: { fts5: true, regex: false, returning: false, ilike: false, timezones: false },
  ...q,
  applyPaging: (sql, limit, offset, bindings) =>
    limitOffsetPaging(sql, limit, offset, bindings, { dummyLimit: '-1' }),
  fullText: (table, cols, raw, query, opts) => {
    if (opts?.mode === 'like') return likeFullText(cols, query);
    return { sql: `${table} MATCH ?`, bindings: [fts5MatchQuery(raw, query)] };
  },
  types: {
    int: 'INTEGER',
    bigint: 'BIGINT',
    float: 'REAL',
    double: 'DOUBLE',
    decimal: (o) => `NUMERIC(${o.precision || 10},${o.scale || 2})`,
    string: (o) => `VARCHAR(${o.length || 255})`,
    text: 'TEXT',
    date: 'DATE',
    time: 'TEXT',
    datetime: 'DATETIME',
    timestamptz: 'DATETIME',
    boolean: 'INTEGER',
    json: 'TEXT',
    uuid: 'CHAR(36)',
    binary: 'BLOB',
  },
  autoIncrementSql: (kind) =>
    kind === 'int' || kind === 'bigint'
      ? { suffix: 'AUTOINCREMENT', primaryKey: true }
      : undefined,
  listColumnsQueries: (quoted) => [
    { sql: `PRAGMA table_info(${quoted})`, map: (r: any) => r.name },
  ],
});

registerDialect(sqliteDialect);
export default sqliteDialect;
