import { describe, it, expect, afterAll } from 'vitest';
import { QueryBuilder } from '../../query-builder.js';
import { setDefaultExecutor, resetQueryKitConfig } from '../../config.js';
import { tryOpenEphemeralMssql, type EphemeralHandle } from './ephemeral.js';
import type { SqlServerExecutor } from '../../adapters/sqlserver.js';

describe('sqlserver integration (throwaway loopback only)', () => {
  let handle: EphemeralHandle<SqlServerExecutor> | undefined;
  let skipReason = '';

  afterAll(async () => {
    try {
      await handle?.destroy();
    } finally {
      resetQueryKitConfig();
    }
  });

  it('inserts, JSON, dates, batches, and nested savepoints on live SQL Server — or records why not', async () => {
    const opened = await tryOpenEphemeralMssql();
    if ('skipped' in opened) {
      skipReason = opened.reason;
      console.warn(`[mssql live] skipped: ${skipReason}`);
      expect(skipReason).toMatch(/No throwaway SQL Server|ECONNREFUSED|Failed to connect|unable to connect/i);
      return;
    }
    handle = opened;
    const exec = handle.exec;
    setDefaultExecutor(exec);

    await exec.executeQuery(
      `CREATE TABLE qk_users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        email NVARCHAR(200),
        meta NVARCHAR(MAX),
        blob_col VARBINARY(MAX),
        n_val BIGINT,
        created_at DATETIMEOFFSET
      )`,
      [],
    );

    const when = new Date('2024-06-01T12:00:00-03:00');
    const blob = Buffer.from('mssql-blob');
    await new QueryBuilder('qk_users').insert({
      email: 'ms@example.test',
      meta: { a: 1 },
      blob_col: blob,
      n_val: 42,
      created_at: when,
    }).make();

    const row = await new QueryBuilder('qk_users').where('email', '=', 'ms@example.test').first<any>();
    expect(row?.email).toBe('ms@example.test');

    const many = Array.from({ length: 800 }, (_, i) => ({ email: `b${i}@example.test` }));
    await exec.executeQuery('CREATE TABLE qk_batch (id INT IDENTITY(1,1) PRIMARY KEY, email NVARCHAR(200))', []);
    const ins = await new QueryBuilder('qk_batch').insert(many).make();
    expect(ins.changes).toBeGreaterThanOrEqual(800);

    await exec.transaction(async (tx) => {
      await tx.executeQuery(`INSERT INTO qk_users (email) VALUES (?)`, ['outer@example.test']);
      await expect(
        tx.transaction!(async (inner) => {
          await inner.executeQuery(`INSERT INTO qk_users (email) VALUES (?)`, ['inner@example.test']);
          throw new Error('inner-fail');
        }),
      ).rejects.toThrow('inner-fail');
    });
    const kept = await exec.executeQuery(`SELECT email FROM qk_users WHERE email IN (?, ?)`, [
      'outer@example.test',
      'inner@example.test',
    ]);
    const emails = kept.data.map((r: any) => r.email);
    expect(emails).toContain('outer@example.test');
    expect(emails).not.toContain('inner@example.test');
  }, 60_000);
});
