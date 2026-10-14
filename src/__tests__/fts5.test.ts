import { describe, it, expect, afterEach } from 'vitest'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'
import { QueryBuilder } from '../query-builder.js'
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js'
import {
  fts5CreateSql,
  fts5DropSql,
  fts5RebuildSql,
  fts5MatchQuery,
  fts5MatchSql,
  fts5ContentSyncTriggersSql,
  createFts5VirtualTable,
  rebuildFts5Index,
} from '../sql/fts5.js'
import { UnsafeIdentifierError } from '../sql/identifiers.js'

describe('FTS5 helpers', () => {
  it('builds CREATE VIRTUAL TABLE with content= and tokenize', () => {
    const sql = fts5CreateSql({
      name: 'docs_fts',
      columns: ['title', 'body', 'lang'],
      content: 'docs',
      contentRowid: 'id',
      tokenize: 'porter unicode61',
      prefix: '2 3',
      unindexed: ['lang'],
    })
    expect(sql).toBe(
      `CREATE VIRTUAL TABLE IF NOT EXISTS "docs_fts" USING fts5(title, body, lang UNINDEXED, content='docs', content_rowid='id', tokenize='porter unicode61', prefix='2 3')`,
    )
  })

  it('rejects empty columns and hostile identifiers', () => {
    expect(() => fts5CreateSql({ name: 'x', columns: [] })).toThrow(/at least one column/)
    expect(() => fts5CreateSql({ name: 'x;drop', columns: ['a'] })).toThrow(UnsafeIdentifierError)
    expect(() => fts5MatchQuery(['title;drop'], 'q')).toThrow(UnsafeIdentifierError)
  })

  it('fts5MatchQuery uses a column filter and Match SQL binds', () => {
    expect(fts5MatchQuery(['title', 'body'], ' coffee ')).toBe('{title body}: coffee')
    expect(fts5MatchSql('docs_fts', ['title'], 'kit')).toEqual({
      sql: '"docs_fts" MATCH ?',
      bindings: ['{title}: kit'],
    })
    expect(fts5DropSql('docs_fts')).toBe('DROP TABLE IF EXISTS "docs_fts"')
    expect(fts5RebuildSql('docs_fts')).toBe(`INSERT INTO "docs_fts"("docs_fts") VALUES('rebuild')`)
  })

  it('content-sync trigger SQL quotes every identifier', () => {
    const sqls = fts5ContentSyncTriggersSql('docs_fts', 'docs', ['title', 'body'], 'id')
    expect(sqls).toHaveLength(3)
    expect(sqls[0]).toMatch(/AFTER INSERT ON "docs"/)
    expect(sqls[1]).toMatch(/VALUES \('delete', old\.id\)/)
    expect(sqls[2]).toMatch(/AFTER UPDATE ON "docs"/)
    expect(() => fts5ContentSyncTriggersSql('x', 'y', [])).toThrow(/at least one column/)
  })
})

describe('FTS5 live SQLite', () => {
  afterEach(() => resetQueryKitConfig())

  it('createFts5VirtualTable + MATCH via whereFullText', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT)')
    await createFts5VirtualTable(db, {
      name: 'docs_fts',
      columns: ['title', 'body'],
      content: 'docs',
      contentRowid: 'id',
    })
    await new QueryBuilder('docs').insert([
      { title: 'QueryKit', body: 'typed SQL toolkit' },
      { title: 'Other', body: 'unrelated row' },
    ]).make()
    await rebuildFts5Index(db, 'docs_fts')

    const hits = await new QueryBuilder('docs_fts').whereFullText(['title', 'body'], 'toolkit').all<any>()
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('QueryKit')

    const none = await new QueryBuilder('docs_fts').whereFullText(['title'], 'toolkit').all<any>()
    expect(none).toHaveLength(0)

    db.close()
  })

  it('content-sync triggers keep FTS in lockstep without rebuild', async () => {
    const db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync('CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, body TEXT)')
    await createFts5VirtualTable(db, { name: 'notes_fts', columns: ['title', 'body'] })
    for (const sql of fts5ContentSyncTriggersSql('notes_fts', 'notes', ['title', 'body'], 'id')) {
      db.runSync(sql, [])
    }
    await new QueryBuilder('notes').insert({ title: 'hello', body: 'full text world' }).make()
    const hits = await new QueryBuilder('notes_fts').whereFullText(['body'], 'world').all<any>()
    expect(hits).toHaveLength(1)
    db.close()
  })
})
