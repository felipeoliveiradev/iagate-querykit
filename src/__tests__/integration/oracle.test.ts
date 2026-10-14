import { describe, it, expect, afterAll } from 'vitest';
import { QueryBuilder } from '../../query-builder.js';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { tryOpenEphemeralOracle, type EphemeralHandle } from './ephemeral.js';
import type { OracleExecutor } from '../../adapters/oracle.js';

describe('oracle integration (throwaway loopback only)', () => {
  let handle: EphemeralHandle<OracleExecutor> | undefined;

  afterAll(async () => {
    try {
      await handle?.destroy();
    } finally {
      resetQueryKitConfig();
    }
  });

  it('inserts and nested savepoints on live Oracle Free — or records why not', async () => {
    const opened = await tryOpenEphemeralOracle();
    if ('skipped' in opened) {
      console.warn(`[oracle live] skipped: ${opened.reason}`);
      expect(opened.reason).toMatch(/No throwaway Oracle|NJS-|DPI-|connection|refused|TNS/i);
      return;
    }
    handle = opened;
    const exec = handle.exec;
    setDefaultExecutor(exec);
    const table = handle.database;

    await new QueryBuilder(table).insert({ email: 'ora@example.test', n_val: 7 }).make();
    const row = await new QueryBuilder(table).where('email', '=', 'ora@example.test').first<any>();
    expect(String(row?.EMAIL || row?.email)).toBe('ora@example.test');

    await exec.transaction(async (tx) => {
      await tx.executeQuery(`INSERT INTO "${table}" ("email", "n_val") VALUES (?, ?)`, ['outer@example.test', 1]);
      await expect(
        tx.transaction!(async (inner) => {
          await inner.executeQuery(`INSERT INTO "${table}" ("email", "n_val") VALUES (?, ?)`, ['inner@example.test', 2]);
          throw new Error('inner-fail');
        }),
      ).rejects.toThrow('inner-fail');
    });
    const kept = await exec.executeQuery(`SELECT "email" FROM "${table}" WHERE "email" IN (?, ?)`, [
      'outer@example.test',
      'inner@example.test',
    ]);
    const emails = kept.data.map((r: any) => String(r.EMAIL || r.email));
    expect(emails).toContain('outer@example.test');
    expect(emails).not.toContain('inner@example.test');
  }, 60_000);
});
