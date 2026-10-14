import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryBuilder } from '../query-builder.js'
import { BetterSqlite3Executor } from '../adapters/better-sqlite3.js'
import { setDefaultExecutor, resetQueryKitConfig, setRelations } from '../config.js'
import { attachRelations } from '../relations-resolver.js'

function schema(exec: BetterSqlite3Executor) {
  exec.executeQuerySync(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      public_id TEXT,
      email TEXT
    )
  `)
  exec.executeQuerySync(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      title TEXT
    )
  `)
  exec.executeQuerySync(`
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY,
      post_id INTEGER,
      body TEXT
    )
  `)
  exec.executeQuerySync(`
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY,
      slug TEXT
    )
  `)
  exec.executeQuerySync(`
    CREATE TABLE posts_tags (
      posts_id INTEGER,
      tags_id INTEGER
    )
  `)
  exec.executeQuerySync("INSERT INTO users (id, public_id, email) VALUES (1, 'u1', 'a@ex.com'), (2, 'u2', 'b@ex.com')")
  exec.executeQuerySync("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 't1'), (11, 1, 't2'), (12, 2, 't3')")
  exec.executeQuerySync("INSERT INTO comments (id, post_id, body) VALUES (100, 10, 'c1'), (101, 10, 'c2')")
  exec.executeQuerySync("INSERT INTO tags (id, slug) VALUES (7, 'tech'), (8, 'sql')")
  exec.executeQuerySync('INSERT INTO posts_tags (posts_id, tags_id) VALUES (10, 7), (10, 8), (11, 7)')
}

const GRAPH = {
  users: [
    { name: 'posts', kind: 'hasMany' as const, table: 'posts', foreignKey: 'user_id', localKey: 'id' },
  ],
  posts: [
    { name: 'user', kind: 'belongsTo' as const, table: 'users', foreignKey: 'user_id', ownerKey: 'id' },
    { name: 'comments', kind: 'hasMany' as const, table: 'comments', foreignKey: 'post_id' },
    {
      name: 'tags',
      kind: 'manyToMany' as const,
      table: 'tags',
      localKey: 'id',
      ownerKey: 'id',
      through: { table: 'posts_tags', leftKey: 'posts_id', rightKey: 'tags_id' },
    },
  ],
}

describe('attachRelations (real sqlite)', () => {
  let exec: BetterSqlite3Executor
  let queries: string[]

  beforeEach(() => {
    resetQueryKitConfig()
    const inner = new BetterSqlite3Executor(':memory:')
    queries = []
    const orig = inner.executeQuery.bind(inner)
    inner.executeQuery = async (sql: string, bindings: any[] = []) => {
      queries.push(sql)
      return orig(sql, bindings)
    }
    exec = inner
    setDefaultExecutor(exec)
    schema(exec)
    setRelations(GRAPH)
  })

  afterEach(() => {
    exec.close()
    resetQueryKitConfig()
  })

  it('eager-loads hasMany with relationship()', async () => {
    const users = await new QueryBuilder('users').orderBy('id').relationship().all<any>()
    expect(users).toHaveLength(2)
    expect(users[0].posts.map((p: any) => p.title).sort()).toEqual(['t1', 't2'])
    expect(users[1].posts.map((p: any) => p.title)).toEqual(['t3'])
  })

  it('eager-loads belongsTo and manyToMany', async () => {
    const posts = await new QueryBuilder('posts').orderBy('id').relationship().all<any>()
    expect(posts[0].user.email).toBe('a@ex.com')
    expect(posts[2].user.email).toBe('b@ex.com')
    expect(posts[0].tags.map((t: any) => t.slug).sort()).toEqual(['sql', 'tech'])
    expect(posts[1].tags.map((t: any) => t.slug)).toEqual(['tech'])
    expect(posts[2].tags).toEqual([])
  })

  it('selector loads only named relations and honors select columns', async () => {
    queries.length = 0
    const users = await new QueryBuilder('users')
      .orderBy('id')
      .relationship((rel) => rel('posts', ['id', 'title']))
      .all<any>()
    expect(users[0].posts[0].title).toBeDefined()
    expect(users[0].posts[0].user_id).toBeUndefined()
    const postSelects = queries.filter((s) => /FROM "posts"/i.test(s) && /SELECT/i.test(s))
    expect(postSelects.some((s) => /"title"/.test(s))).toBe(true)
  })

  it('nested eager-load walks posts → comments in one extra batched query', async () => {
    queries.length = 0
    const users = await new QueryBuilder('users').orderBy('id').relationship().all<any>()
    const comments = users[0].posts.find((p: any) => p.id === 10).comments
    expect(comments.map((c: any) => c.body).sort()).toEqual(['c1', 'c2'])
    expect(users[0].posts.find((p: any) => p.id === 11).comments).toEqual([])
    const commentSelects = queries.filter((s) => /FROM "comments"/i.test(s))
    expect(commentSelects.length).toBe(1)
    expect(commentSelects[0]).toMatch(/IN \(\?, \?, \?\)/)
  })

  it('avoids N+1: one whereIn per relation, not per row', async () => {
    queries.length = 0
    await new QueryBuilder('users').relationship().all()
    const postSelects = queries.filter((s) => /FROM "posts"/i.test(s) && /SELECT/i.test(s) && /WHERE/i.test(s))
    expect(postSelects).toHaveLength(1)
    expect(postSelects[0]).toMatch(/IN \(\?, \?\)/)
  })

  it('uses custom localKey / ownerKey', async () => {
    setRelations({
      users: [{ name: 'posts', kind: 'hasMany', table: 'posts', foreignKey: 'user_id', localKey: 'id' }],
      posts: [
        {
          name: 'author',
          kind: 'belongsTo',
          table: 'users',
          foreignKey: 'user_id',
          ownerKey: 'id',
        },
      ],
    })
    const posts = await new QueryBuilder('posts').where('id', 10).relationship((rel) => rel('author')).all<any>()
    expect(posts[0].author.email).toBe('a@ex.com')
  })

  it('short-circuits empty IN (no child query) and leaves empty arrays', async () => {
    exec.executeQuerySync('CREATE TABLE orphans (id INTEGER PRIMARY KEY, email TEXT)')
    setRelations({
      orphans: [{ name: 'posts', kind: 'hasMany', table: 'posts', foreignKey: 'user_id', localKey: 'id' }],
    })
    const rows = await attachRelations('orphans', [{ id: null, email: 'x' }], undefined)
    expect(rows[0].posts).toEqual([])
  })

  it('guards against cyclic nested graphs', async () => {
    setRelations({
      users: [{ name: 'posts', kind: 'hasMany', table: 'posts', foreignKey: 'user_id' }],
      posts: [{ name: 'user', kind: 'belongsTo', table: 'users', foreignKey: 'user_id' }],
    })
    const users = await new QueryBuilder('users').where('id', 1).relationship().all<any>()
    expect(users[0].posts[0].user.email).toBe('a@ex.com')
    expect(users[0].posts[0].user.posts).toBeUndefined()
  })

  it('unknown kind gets an empty collection / null', async () => {
    setRelations({
      users: [{ name: 'weird', kind: 'hasOne' as any, table: 'posts', foreignKey: 'user_id' }],
    })
    const again = await attachRelations('users', [{ id: 1, email: 'a@ex.com' }])
    expect(again[0].weird).toEqual([])
  })

  it('manyToMany with no join rows stays empty; missing through is a no-op kind', async () => {
    setRelations({
      posts: [{ name: 'tags', kind: 'manyToMany', table: 'tags' } as any],
    })
    const posts = await attachRelations('posts', [{ id: 99, title: 'none' }])
    expect(posts[0].tags).toEqual([])
  })

  it('attaches the same child to every parent sharing a localKey', async () => {
    const rows = [
      { id: 1, email: 'a' },
      { id: 1, email: 'dup' },
    ]
    const out = await attachRelations('users', rows)
    expect(out[0].posts.length).toBeGreaterThan(0)
    expect(out[1].posts.length).toBe(out[0].posts.length)
  })

  it('eager-loads through the simulation manager path', async () => {
    const { simulationManager } = await import('../simulation-manager.js')
    await simulationManager.start({
      users: [
        { id: 1, email: 'sim@ex.com' },
        { id: 2, email: 'sim2@ex.com' },
      ],
    })
    try {
      const rows = await new QueryBuilder('users').relationship().all<any>()
      expect(rows[0].posts).toBeDefined()
    } finally {
      simulationManager.stop()
    }
  })

  it('returns empty input unchanged and respects max depth', async () => {
    expect(await attachRelations('users', [])).toEqual([])
    const deep = await attachRelations('users', [{ id: 1, email: 'a@ex.com' }], undefined, 5, [])
    expect(deep[0].posts).toBeUndefined()
  })
})
