import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setDefaultExecutor } from '../config'
import { QueryBuilder } from '../query-builder'
import { runSeed, Seed } from '../seed'

class ExecR {
  data: Record<string, any[]> = {
    users: [{ id: 1, email: 'a@ex.com' }, { id: 2, email: 'b@ex.com' }],
    posts: [{ id: 10, user_id: 1, title: 't1' }, { id: 11, user_id: 2, title: 't2' }],
    tags: [{ id: 100, name: 'tech' }],
    posts_tags: [{ posts_id: 10, tags_id: 100 }],
  }
  async executeQuery(sql: string, bindings: any[]) {
    const m = /FROM\s+(\w+)/i.exec(sql)
    const tbl = m?.[1]?.replace(/[`"']/g,'') as keyof ExecR['data']
    if (/INSERT INTO/i.test(sql)) return { data: [], affectedRows: 1, lastInsertId: 99 }
    if (tbl && this.data[tbl]) return { data: this.data[tbl] }
    return { data: [] }
  }
  executeQuerySync(sql: string, b: any[]) { return { data: [] } }
  runSync(sql: string, b: any[]) { return { changes: 1, lastInsertRowid: 1 } }
}

// mock registry for relations resolver import
vi.stubGlobal('process', { env: { QK_RELATIONS_PATH: '' } })
vi.mock('../relations-resolver', async (orig) => {
  const mod = await orig() as any
  const attachRelations = async (table: string, rows: any[], selector?: (rel:(n:string,s?:string[])=>void)=>void) => {
    // minimal fake: attach static relationships for validation without hitting DB
    if (table === 'users') {
      return rows.map(r => ({ ...r, posts: [{ id: 10, user_id: r.id, title: 't' }] }))
    }
    if (table === 'posts') {
      return rows.map(r => ({ ...r, user: { id: r.user_id, email: 'x@ex.com' } }))
    }
    return rows
  }
  return { ...mod, attachRelations }
})

describe('relationship()', () => {
  beforeEach(() => setDefaultExecutor(new ExecR() as any))

  it('attaches related collections for users', async () => {
    const out = await new QueryBuilder('users').relationship().all()
    expect(out[0].posts).toBeDefined()
  })

  it('attaches belongsTo for posts with selector', async () => {
    const out = await new QueryBuilder('posts').relationship(rel => rel('user',['id','email'])).all()
    expect(out[0].user).toBeDefined()
  })
})

describe('runSeed', () => {
  beforeEach(() => setDefaultExecutor(new ExecR() as any))
  it('inserts array rows', async () => {
    const n = await runSeed('users', [{ email: 'seed@ex.com', active: 1 }], { truncate: true })
    expect(n).toBe(1)
  })
  it('supports class Seed', async () => {
    class S extends Seed<{ email: string, active: number }> {
      async run() { return [{ email: 'x@ex.com', active: 1 }] }
    }
    const n = await runSeed('users', new S())
    expect(n).toBe(1)
  })
}) 