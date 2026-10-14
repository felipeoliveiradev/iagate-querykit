import { defineDialect, limitOffsetPaging } from '../define.js';
import { makeQuoter } from '../quoting.js';
import { wrapDouble } from '../../engine/idents.js';
import { registerDialect } from '../../engine/registry.js';
import { toPostgresParams } from '../../sql/placeholders.js';

const q = makeQuoter(wrapDouble);

export const postgresDialect = defineDialect({
  name: 'postgres',
  maxBindParams: 65535,
  capabilities: {
    fts5: false,
    regex: true,
    returning: true,
    ilike: true,
    arrays: true,
    timezones: true,
    windowFunctions: true,
  },
  ...q,
  applyPaging: (sql, limit, offset, bindings) => limitOffsetPaging(sql, limit, offset, bindings),
  returningInsertSql: (sql) => (/^\s*insert\b/i.test(sql) ? `${sql.replace(/;?\s*$/, '')} RETURNING *` : sql),
  toDriverParams: (sql) => ({ sql: toPostgresParams(sql) }),
  iLikeSql: (col) => `${col} ILIKE ?`,
  jsonContains: (col, value) => ({
    sql: `${col} @> ?::jsonb`,
    bindings: [typeof value === 'string' ? value : JSON.stringify(value)],
  }),
  fullText: (_table, cols, _raw, query, opts) => ({
    sql: `to_tsvector(?::regconfig, ${cols.join(" || ' ' || ")}) @@ plainto_tsquery(?::regconfig, ?)`,
    bindings: [opts?.language || 'english', opts?.language || 'english', query],
  }),
  findInSet: (col) => `? = ANY(string_to_array(${col}, ','))`,
  arrayContains: (col) => `? = ANY(${col})`,
  whereDate: (col, date) => ({ sql: `DATE(${col}) = DATE(?)`, bindings: [date] }),
  whereDateRangeTz: (col, start, end, tz) => ({
    sql: `${col} AT TIME ZONE 'UTC' AT TIME ZONE ? BETWEEN ? AND ?`,
    bindings: [tz, start, end],
  }),
  whereRegex: (col, pattern, flags) => ({
    sql: String(flags || '').toLowerCase().includes('i') ? `${col} ~* ?` : `${col} ~ ?`,
    bindings: [pattern],
  }),
  radians: (expr) => `radians(${expr})`,
  migrationsTableSql: () =>
    `CREATE TABLE IF NOT EXISTS querykit_migrations (id VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW())`,
  listTriggersQueries: () => [
    { sql: 'SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal', map: (r: any) => r.tgname || r.name },
  ],
  listViewsQueries: () => [
    { sql: 'SELECT table_name FROM information_schema.views WHERE table_schema = current_schema()', map: (r: any) => r.table_name },
  ],
  listColumnsQueries: (_quoted, raw) => [
    {
      sql: 'SELECT column_name FROM information_schema.columns WHERE table_name = ?',
      bindings: [raw],
      map: (r: any) => r.column_name,
    },
  ],
  createTriggerSql: (name, table, timing, event, body) => {
    const ident = q.quoteIdent(name);
    const tbl = q.quoteIdent(table);
    const fn = q.quoteIdent(`querykit_${name}_fn`);
    const clean = body.trim().replace(/;?\s*$/, '');
    return [
      `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN ${clean}; IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END; $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS ${ident} ON ${tbl}`,
      `CREATE TRIGGER ${ident} ${timing === 'INSTEAD OF' ? 'INSTEAD OF' : timing} ${event} ON ${tbl} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    ];
  },
  dropTriggerSql: (name, table) =>
    table
      ? `DROP TRIGGER IF EXISTS ${q.quoteIdent(name)} ON ${q.quoteIdent(table)}`
      : `DROP TRIGGER IF EXISTS ${q.quoteIdent(name)}`,
  types: {
    int: 'INTEGER',
    bigint: 'BIGINT',
    float: 'REAL',
    double: 'DOUBLE PRECISION',
    decimal: (o) => `DECIMAL(${o.precision || 10},${o.scale || 2})`,
    string: (o) => `VARCHAR(${o.length || 255})`,
    text: 'TEXT',
    date: 'DATE',
    time: 'TIME',
    datetime: 'TIMESTAMP',
    timestamptz: 'TIMESTAMPTZ',
    boolean: 'BOOLEAN',
    json: 'JSONB',
    uuid: 'UUID',
    binary: 'BYTEA',
  },
  uuidV4Sql: () => 'gen_random_uuid()',
  autoIncrementSql: (kind, opts) => {
    if (opts?.mode === 'serial') return { replaceType: kind === 'bigint' ? 'BIGSERIAL' : 'SERIAL' };
    const m = opts?.mode === 'always' ? 'ALWAYS' : 'BY DEFAULT';
    return { suffix: `GENERATED ${m} AS IDENTITY` };
  },
});

registerDialect(postgresDialect);
export default postgresDialect;
