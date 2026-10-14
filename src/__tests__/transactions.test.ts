import { describe, it, expect, beforeEach } from 'vitest';
import { QueryBuilder } from '../query-builder.js';
import { setDefaultExecutor, resetQueryKitConfig } from '../config.js';

describe('transactions (C1, B4)', () => {
  beforeEach(() => resetQueryKitConfig());

  it('updateOrInsert uses transaction() when present', async () => {
    const calls: string[] = [];
    const exec = {
      dialect: 'sqlite' as const,
      queries: [] as { sql: string; bindings: any[] }[],
      executeQuery: async (sql: string, bindings: any[] = []) => {
        calls.push(sql);
        return { data: [], affectedRows: 0 };
      },
      run: async (sql: string, bindings: any[] = []) => {
        calls.push(sql);
        if (/^update/i.test(sql)) return { changes: 0, lastInsertRowid: 0 };
        return { changes: 1, lastInsertRowid: 9 };
      },
      async transaction<T>(fn: (tx: any) => Promise<T>) {
        calls.push('BEGIN');
        const out = await fn(this);
        calls.push('COMMIT');
        return out;
      },
    };
    setDefaultExecutor(exec as any);
    const res = await new QueryBuilder('users').updateOrInsert({ email: 'a@b.com' }, { active: 1 }).make();
    expect(res.changes).toBe(1);
    expect(calls[0]).toBe('BEGIN');
    expect(calls).toContain('COMMIT');
    expect(calls.some((s) => /^UPDATE/.test(s))).toBe(true);
    expect(calls.some((s) => /^INSERT/.test(s))).toBe(true);
  });
});
