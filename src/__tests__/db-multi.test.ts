import { describe, it, expect, beforeEach } from 'vitest'
import { setDefaultExecutor, setMultiDbRegistry, setTableToDatabase, setExecutorResolver, setDatabaseName } from '../config'
import { QueryBuilder } from '../query-builder'
import { Model } from '../model'

class ExecMock {
  public dialect?: any
  public calls: string[] = []
  constructor(public name: string) {}
  executeQuery(sql: string, bindings: any[]) { this.calls.push(`${this.name}:executeQuery`); return Promise.resolve({ data: [] }); }
  executeQuerySync(sql: string, bindings: any[]) { this.calls.push(`${this.name}:executeQuerySync`); return { data: [] }; }
  runSync(sql: string, bindings: any[]) { this.calls.push(`${this.name}:runSync`); return { changes: 1, lastInsertRowid: 1 } }
}

describe('Multi-db selection and bank overrides', () => {
  let core: ExecMock;
  let analytics: ExecMock;

  beforeEach(() => {
    core = new ExecMock('core');
    analytics = new ExecMock('analytics');
    setDefaultExecutor(core as any);
    setMultiDbRegistry({ getAdapter: (db: string) => { if (db === 'analytics') return analytics; if (db === 'core') return core; throw new Error('unknown db'); } } as any);
    setTableToDatabase({ users: 'core' });
    setExecutorResolver(() => undefined);
    setDatabaseName('core')
  })

  it('uses tableToDatabase mapping by default', async () => {
    await new QueryBuilder('users').insert({ email: 'a@b.com' }).make()
    expect(core.calls).toContain('core:runSync')
    expect(analytics.calls.length).toBe(0)
  })

  it('QueryBuilder.bank overrides mapping', async () => {
    await new QueryBuilder('users').bank('analytics').insert({ email: 'b@b.com' }).make()
    expect(analytics.calls).toContain('analytics:runSync')
    expect(core.calls.length).toBe(0)
  })

  it('bank array tries in order and picks first available', async () => {
    await new QueryBuilder('orders').bank(['unknown','analytics','core']).insert({ id: 1 }).make()
    expect(analytics.calls).toContain('analytics:runSync')
  })

  it('executorResolver has highest precedence', async () => {
    setExecutorResolver((table) => (table === 'orders' ? analytics as any : undefined))
    await new QueryBuilder('orders').insert({ id: 2 }).make()
    expect(analytics.calls).toContain('analytics:runSync')
  })

  it('Model static banks is applied by default; instance.bank overrides', async () => {
    class User extends Model { static tableName = 'users'; static banks = ['analytics'] }
    const u = new User(); (u as any).email = 'x@y.com'
    await u.save()
    expect(analytics.calls).toContain('analytics:runSync')
    const u2 = new User().bank('core'); (u2 as any).email = 'z@y.com'
    await u2.save()
    expect(core.calls).toContain('core:runSync')
  })

  it('falls back to multiDb + databaseName when no mapping and no banksHint', async () => {
    setTableToDatabase({})
    await new QueryBuilder('unknown').insert({ id: 3 }).make()
    expect(core.calls).toContain('core:runSync')
  })

  it('throws when no default executor and no registry mapping available', async () => {
    setMultiDbRegistry(undefined as any)
    setDefaultExecutor(undefined as any)
    await expect(new QueryBuilder('x').insert({ a: 1 }).make()).rejects.toThrow('No executor configured for QueryKit')
  })
}) 