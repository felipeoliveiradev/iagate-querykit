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
}); 