/**
 * Example dialect: proves a new database can be plugged in without core edits.
 * SQL shape matches SQLite; pair it with BetterSqlite3Executor(':memory:')
 * or any executor that speaks this dialect.name.
 */
import { defineDialect, limitOffsetPaging, likeFullText } from '../define.js';
import { makeQuoter } from '../quoting.js';
import { wrapDouble } from '../../engine/idents.js';
import { registerDialect } from '../../engine/registry.js';
import { UnsupportedFeatureError } from '../../engine/errors.js';

const q = makeQuoter(wrapDouble);

export const memoryDialect = defineDialect({
  name: 'memory',
  maxBindParams: 999,
  capabilities: { fts5: false, regex: false, json: true, savepoints: true },
  ...q,
  applyPaging: (sql, limit, offset, bindings) =>
    limitOffsetPaging(sql, limit, offset, bindings, { dummyLimit: '-1' }),
  fullText: (_t, cols, _r, query) => likeFullText(cols, query),
  whereRegex: () => {
    throw new UnsupportedFeatureError('regex', 'memory');
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
});

registerDialect(memoryDialect);
export default memoryDialect;
