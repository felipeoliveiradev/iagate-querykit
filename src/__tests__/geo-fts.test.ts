import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryBuilder } from '../query-builder.js'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js'
import type { SqlDialect } from '../sql/dialect.js'

function exec(dialect: SqlDialect) {
  return {
    dialect,
    executeQuery: async () => ({ data: [] }),
    executeQuerySync: () => ({ data: [] }),
  }
}

function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) || []).length
}

describe('geo + full-text SQL (all dialects)', () => {
  afterEach(() => resetQueryKitConfig())

  it('whereFullText quotes columns and binds per dialect', () => {
    setDefaultExecutor(exec('sqlite') as any)
    const sqlite = new QueryBuilder('articles').whereFullText(['title', 'body'], 'querykit').toSql()
    expect(sqlite.sql).toMatch(/"articles" MATCH \?/)
    expect(sqlite.bindings).toEqual(['{title body}: querykit'])

    setDefaultExecutor(exec('postgres') as any)
    const pg = new QueryBuilder('articles').whereFullText(['title', 'body'], 'querykit', 'english').toSql()
    expect(pg.sql).toMatch(/to_tsvector\(\?::regconfig, "title" \|\| ' ' \|\| "body"\)/)
    expect(pg.sql).toMatch(/plainto_tsquery\(\?::regconfig, \?\)/)
    expect(pg.bindings).toEqual(['english', 'english', 'querykit'])
    expect(pg.bindings.length).toBe(countPlaceholders(pg.sql))

    setDefaultExecutor(exec('mysql') as any)
    const my = new QueryBuilder('articles').whereFullText(['title', 'body'], 'querykit').toSql()
    expect(my.sql).toMatch(/MATCH\(`title`, `body`\) AGAINST\(\? IN NATURAL LANGUAGE MODE\)/)
    expect(my.bindings).toEqual(['querykit'])

    setDefaultExecutor(exec('oracle') as any)
    const ora = new QueryBuilder('articles').whereFullText(['title', 'body'], 'querykit').toSql()
    expect(ora.sql).toMatch(/CONTAINS\("title", \?\) > 0 OR CONTAINS\("body", \?\) > 0/)
    expect(ora.bindings).toEqual(['querykit', 'querykit'])

    setDefaultExecutor(exec('mssql') as any)
    const ms = new QueryBuilder('articles').whereFullText(['title', 'body'], 'querykit').toSql()
    expect(ms.sql).toMatch(/CONTAINS\(\[title\], \?\) OR CONTAINS\(\[body\], \?\)/)
    expect(ms.bindings).toEqual(['querykit', 'querykit'])
  })

  it('whereFullText rejects empty columns and no-ops blank queries', () => {
    setDefaultExecutor(exec('sqlite') as any)
    expect(() => new QueryBuilder('articles').whereFullText([], 'x')).toThrow(/at least one column/)
    const { sql } = new QueryBuilder('articles').whereFullText(['title'], '   ').toSql()
    expect(sql).not.toMatch(/MATCH/)
    expect(sql).not.toMatch(/LIKE/)
  })

  it('whereNearby uses Haversine, quotes columns, and binds SELECT+WHERE', () => {
    setDefaultExecutor(exec('sqlite') as any)
    const sqlite = new QueryBuilder('stores').whereNearby('lat', 'lng', -23.55, -46.63, 10).toSql()
    expect(sqlite.sql).toContain('6371 * acos')
    expect(sqlite.sql).toContain('0.017453292519943295')
    expect(sqlite.sql).not.toContain('radians(')
    expect(sqlite.bindings.length).toBe(countPlaceholders(sqlite.sql))

    setDefaultExecutor(exec('postgres') as any)
    const pg = new QueryBuilder('stores').whereNearby('lat', 'lng', -23.55, -46.63, 10).toSql()
    expect(pg.sql).toContain('radians(')
    expect(pg.sql).toContain('"lat"')
    expect(pg.bindings.length).toBe(countPlaceholders(pg.sql))

    setDefaultExecutor(exec('mysql') as any)
    expect(new QueryBuilder('stores').whereNearby('lat', 'lng', 1, 2, 3).toSql().sql).toContain('radians(')

    setDefaultExecutor(exec('oracle') as any)
    expect(new QueryBuilder('stores').whereNearby('lat', 'lng', 1, 2, 3).toSql().sql).toContain('radians(')

    setDefaultExecutor(exec('mssql') as any)
    const ms = new QueryBuilder('stores').whereNearby('lat', 'lng', 1, 2, 3).toSql()
    expect(ms.sql).toContain('[lat]')
    expect(ms.sql).toContain('radians(')
  })

  it('whereNearby rejects non-finite / negative radius', () => {
    setDefaultExecutor(exec('sqlite') as any)
    expect(() => new QueryBuilder('stores').whereNearby('lat', 'lng', Number.NaN, 0, 1)).toThrow(/finite/)
    expect(() => new QueryBuilder('stores').whereNearby('lat', 'lng', 0, 0, -1)).toThrow(/radius/)
  })
})

describe('geo + full-text live SQLite', () => {
  let db: BetterSqlite3Executor

  beforeEach(async () => {
    resetQueryKitConfig()
    db = new BetterSqlite3Executor(':memory:')
    setDefaultExecutor(db)
    db.executeQuerySync(`
      CREATE TABLE places (
        id INTEGER PRIMARY KEY,
        name TEXT,
        body TEXT,
        lat REAL,
        lng REAL
      )
    `)
    db.executeQuerySync(`
      INSERT INTO places (name, body, lat, lng) VALUES
        ('Sao Paulo', 'coffee shop downtown', -23.5505, -46.6333),
        ('Osasco', 'warehouse', -23.5329, -46.7916),
        ('Lisbon', 'pastelaria', 38.7223, -9.1393)
    `)
    const { createFts5VirtualTable, rebuildFts5Index } = await import('../sql/fts5.js')
    await createFts5VirtualTable(db, {
      name: 'places_fts',
      columns: ['name', 'body'],
      content: 'places',
      contentRowid: 'id',
    })
    await rebuildFts5Index(db, 'places_fts')
  })

  afterEach(() => {
    db.close()
    resetQueryKitConfig()
  })

  it('whereFullText FTS5 MATCH finds tokens', async () => {
    const rows = await new QueryBuilder('places_fts').whereFullText(['name', 'body'], 'coffee').all<any>()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Sao Paulo')
  })

  it('whereNearby returns only points inside the radius and a distance_km', async () => {
    const rows = await new QueryBuilder('places')
      .whereNearby('lat', 'lng', -23.5505, -46.6333, 20)
      .orderBy('distance_km', 'ASC')
      .all<any>()
    const names = rows.map((r) => r.name)
    expect(names).toContain('Sao Paulo')
    expect(names).toContain('Osasco')
    expect(names).not.toContain('Lisbon')
    expect(rows[0].distance_km).toBeLessThan(1)
    expect(rows[1].distance_km).toBeGreaterThan(5)
  })

  it('whereRegex sqlite fallback matches a simplified LIKE', async () => {
    const rows = await new QueryBuilder('places').whereRegex('name', 'Sao').all<any>()
    expect(rows.some((r) => r.name.includes('Sao'))).toBe(true)
  })
})
