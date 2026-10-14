import { describe, it, expect } from 'vitest';
import { buildCreateTriggerSql, buildDropTriggerSql } from '../trigger-manager.js';

describe('trigger DDL (D2/D3)', () => {
  it('emits sqlite IF NOT EXISTS', () => {
    const [sql] = buildCreateTriggerSql('trg', 'users', 'BEFORE', 'UPDATE', 'SELECT 1', 'sqlite');
    expect(sql).toMatch(/CREATE TRIGGER IF NOT EXISTS "trg"/);
    expect(sql).toMatch(/ON "users"/);
    expect(sql).toMatch(/BEGIN SELECT 1; END/);
  });

  it('emits postgres function + trigger', () => {
    const stmts = buildCreateTriggerSql('trg', 'users', 'AFTER', 'INSERT', 'NULL', 'postgres');
    expect(stmts[0]).toMatch(/CREATE OR REPLACE FUNCTION "querykit_trg_fn"/);
    expect(stmts[1]).toMatch(/DROP TRIGGER IF EXISTS "trg" ON "users"/);
    expect(stmts[2]).toMatch(/EXECUTE FUNCTION "querykit_trg_fn"\(\)/);
  });

  it('emits mysql / mssql / oracle variants', () => {
    expect(buildCreateTriggerSql('trg', 'users', 'AFTER', 'DELETE', 'NULL', 'mysql')[0]).toMatch(/CREATE TRIGGER `trg`/);
    expect(buildCreateTriggerSql('trg', 'users', 'AFTER', 'INSERT', 'NULL', 'mssql')[0]).toMatch(/CREATE TRIGGER \[trg\] ON \[users\] AFTER INSERT/);
    expect(buildCreateTriggerSql('trg', 'users', 'BEFORE', 'UPDATE', 'NULL', 'oracle')[0]).toMatch(/CREATE OR REPLACE TRIGGER "trg"/);
  });

  it('drops with dialect-specific SQL', () => {
    expect(buildDropTriggerSql('trg', 'sqlite')).toBe('DROP TRIGGER IF EXISTS "trg"');
    expect(buildDropTriggerSql('trg', 'postgres', 'users')).toBe('DROP TRIGGER IF EXISTS "trg" ON "users"');
    expect(buildDropTriggerSql('trg', 'oracle')).toMatch(/DROP TRIGGER "trg"/);
  });
});
