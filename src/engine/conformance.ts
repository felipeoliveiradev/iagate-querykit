import type { Dialect } from './dialect.js';
import type { DatabaseExecutor } from '../types.js';
import { UnsafeIdentifierError } from '../sql/errors.js';
import { UnsupportedFeatureError } from './errors.js';

export type ConformanceAdapter = {
  dialect: Dialect;
  /** Optional live executor. Throwaway / loopback only. */
  driver?: DatabaseExecutor;
};

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`conformance [${message}]`);
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`conformance expected throw: ${message}`);
}

/**
 * Shared adapter contract. Any new dialect must pass this before it is
 * considered complete. Compile-time checks always run; live checks run
 * when `driver` is provided (throwaway DB only).
 */
export async function runDialectConformance(adapter: ConformanceAdapter): Promise<void> {
  const d = adapter.dialect;
  assert(typeof d.name === 'string' && d.name.length > 0, 'dialect.name');
  assert(Number.isInteger(d.maxBindParams) && d.maxBindParams > 0, 'maxBindParams');
  assert(d.capabilities && typeof d.capabilities === 'object', 'capabilities');

  const users = d.quoteIdent('users');
  assert(users.includes('users'), 'quoteIdent keeps the name');
  assert(users !== 'users', 'quoteIdent wraps the identifier');
  assert(d.quoteTableRef('users AS u').toLowerCase().includes('u'), 'quoteTableRef alias');
  assert(d.quoteSelectItem('*') === '*', 'quoteSelectItem star');
  assertThrows(() => d.quoteIdent('users;drop'), 'hostile identifier rejected');
  assertThrows(() => d.quoteIdent(''), 'empty identifier rejected');

  const bindings: unknown[] = [];
  const paged = d.applyPaging('SELECT 1 AS n FROM t', 10, 5, bindings);
  assert(/limit|offset|fetch/i.test(paged), 'applyPaging emits a page clause');
  assert(bindings.length >= 1, 'applyPaging binds page values');

  const insert = d.returningInsertSql('INSERT INTO t (id) VALUES (?)');
  assert(/insert/i.test(insert), 'returningInsertSql keeps INSERT');

  const driverSql = d.toDriverParams('SELECT * FROM t WHERE id = ?');
  assert(typeof driverSql.sql === 'string' && driverSql.sql.length > 0, 'toDriverParams.sql');

  assert(/like/i.test(d.iLikeSql(users)), 'iLikeSql');
  const json = d.jsonContains(d.quoteIdent('meta'), { a: 1 });
  assert(json.sql.length > 0, 'jsonContains.sql');
  assert(Array.isArray(json.bindings), 'jsonContains.bindings');

  const fts = d.fullText(d.quoteTableRef('docs'), [d.quoteIdent('body')], ['body'], 'querykit', {
    mode: 'like',
  });
  assert(fts.sql.length > 0 && fts.bindings.length > 0, 'fullText like');

  assert(d.findInSet(d.quoteIdent('roles')).includes('?'), 'findInSet');
  assert(d.arrayContains(d.quoteIdent('tags')).includes('?'), 'arrayContains');

  const day = new Date('2024-01-02T12:00:00Z');
  const wd = d.whereDate(d.quoteIdent('created_at'), day);
  assert(wd.sql.length > 0 && wd.bindings.length > 0, 'whereDate');

  const wr = d.whereDateRangeTz(d.quoteIdent('created_at'), day, day, 'UTC');
  assert(wr.sql.length > 0 && wr.bindings.length >= 2, 'whereDateRangeTz');

  try {
    const rx = d.whereRegex(d.quoteIdent('email'), '^a', 'i');
    assert(rx.sql.length > 0, 'whereRegex.sql');
  } catch (err) {
    assert(err instanceof UnsupportedFeatureError, 'whereRegex throws UnsupportedFeatureError');
  }

  assert(d.radians('lat').length > 0, 'radians');
  const sp = d.beginSavepointSql('qk_sp_1');
  assert(/save|transaction/i.test(sp), 'beginSavepointSql');
  assert(typeof d.rollbackSavepointSql('qk_sp_1') === 'string', 'rollbackSavepointSql');
  const release = d.releaseSavepointSql('qk_sp_1');
  assert(release === null || typeof release === 'string', 'releaseSavepointSql');

  assert(/querykit_migrations/i.test(d.migrationsTableSql()), 'migrationsTableSql');
  assert(d.listTriggersQueries().length > 0, 'listTriggersQueries');
  assert(d.listViewsQueries().length > 0, 'listViewsQueries');
  const cols = d.listColumnsQueries(d.quoteTableRef('users'), 'users');
  assert(cols.length > 0, 'listColumnsQueries');

  const createTr = d.createTriggerSql('trg', 'users', 'AFTER', 'INSERT', 'SELECT 1');
  assert(Array.isArray(createTr) && createTr.length > 0, 'createTriggerSql');
  assert(d.dropTriggerSql('trg', 'users').length > 0, 'dropTriggerSql');
  assert(d.dropViewSql('v_users').length > 0, 'dropViewSql');

  assert(d.columnType('int').length > 0, 'columnType int');
  assert(d.columnType('string', { length: 32 }).length > 0, 'columnType string');
  assert(d.columnType('json').length > 0, 'columnType json');
  assert(d.currentTimestampSql().length > 0, 'currentTimestampSql');
  assert(d.uuidV4Sql().length > 0, 'uuidV4Sql');

  assert(d.bind(1) === 1 || d.bind(1) != null, 'bind');
  assert(d.hydrate(1) === 1 || d.hydrate(1n) === 1 || d.hydrate(1) != null, 'hydrate');
  assert(typeof d.mapErrorCode(new Error('x')) === 'string', 'mapErrorCode');

  assertThrows(() => {
    throw new UnsafeIdentifierError('x');
  }, 'UnsafeIdentifierError exists');

  const driver = adapter.driver;
  if (!driver) return;

  const table = `qk_cf_${d.name.replace(/[^a-z0-9]/gi, '')}`;
  const qTable = d.quoteIdent(table);
  const qId = d.quoteIdent('id');
  const qName = d.quoteIdent('name');
  const intType = d.columnType('int');
  const strType = d.columnType('string', { length: 64 });
  try {
    await driver.executeQuery(`CREATE TABLE ${qTable} (${qId} ${intType}, ${qName} ${strType})`, []);
    await driver.executeQuery(`INSERT INTO ${qTable} (${qId}, ${qName}) VALUES (?, ?)`, [1, 'alpha']);
    const { sql: sel } = d.toDriverParams(`SELECT ${qName} FROM ${qTable} WHERE ${qId} = ?`);
    const rows = await driver.executeQuery(sel, [1]);
    assert(Array.isArray(rows.data) && rows.data.length === 1, 'live select');
    if (driver.transaction) {
      await driver.transaction(async (tx) => {
        await tx.executeQuery(`INSERT INTO ${qTable} (${qId}, ${qName}) VALUES (?, ?)`, [2, 'beta']);
      });
    }
  } finally {
    try {
      await driver.executeQuery(`DROP TABLE ${qTable}`, []);
    } catch {
      /* ignore */
    }
  }
}
