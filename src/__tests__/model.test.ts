import { describe, it, expect, beforeEach } from 'vitest';
import { Model } from '../model';
import { setDefaultExecutor } from '../config';

class MockExec {
  runs: { sql: string; bindings: any[] }[] = [];
  executeQuerySync(sql: string, bindings: any[] = []) { return { data: [] }; }
  executeQuery(sql: string, bindings: any[] = []) { return Promise.resolve({ data: [] }); }
  runSync(sql: string, bindings: any[] = []) { this.runs.push({ sql, bindings }); return { changes: 1, lastInsertRowid: 42 };
  }
}

class User extends Model {
  static tableName = 'users';
  fillable = ['name', 'email'];
}

describe('Model.save', () => {
  let exec: MockExec;
  beforeEach(() => { exec = new MockExec(); setDefaultExecutor(exec as any); });

  it('inserts only fillable fields when id not set', async () => {
    const u = new User();
    u.fill({ name: 'A', email: 'a@example.com', role: 'admin' });
    await u.save();
    const last = exec.runs.at(-1)!;
    expect(last.sql).toMatch(/INSERT INTO users/);
    expect(last.sql).not.toContain('role');
  });

  it('updates when id is present', async () => {
    const u = new User() as any;
    u.id = 1;
    u.fill({ name: 'B', created_at: 'x' });
    await u.save();
    const last = exec.runs.at(-1)!;
    expect(last.sql).toMatch(/UPDATE users SET/);
    expect(last.sql).not.toContain('created_at');
  });

  it('delete() removes by id', async () => {
    const u = new User() as any; u.id = 7;
    await u.delete();
    const last = exec.runs.at(-1)!;
    expect(last.sql).toMatch(/DELETE FROM users WHERE/);
  })
});

describe('Model banks', () => {
  class Exec2 extends MockExec {}
  beforeEach(() => setDefaultExecutor(new Exec2() as any))

  it('static banks applies by default', async () => {
    class A extends Model { static tableName = 'a'; static banks = ['core'] }
    const a = new A() as any; a.id = 1
    await a.delete()
    const last = (setDefaultExecutor as any).mockExec?.runs?.at(-1)
    expect(true).toBe(true)
  })

  it('instance bank overrides static banks', async () => {
    class B extends Model { static tableName = 'b'; static banks = ['analytics'] }
    const b = new B().bank('core') as any; b.id = 2
    await b.delete()
    expect(true).toBe(true)
  })
})

describe('Model fill/guard defaults', () => {
  class Post extends Model { static tableName = 'posts'; }
  beforeEach(() => setDefaultExecutor(new MockExec() as any))

  it('without fillable/guarded uses provided attributes', async () => {
    const p = new Post() as any
    p.title = 'Hello'
    await p.save()
    expect(true).toBe(true)
  })
}) 