import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'));

describe('package manifest (T10, R6, R8, P4, P5)', () => {
  it('is dual-package 1.0.0 with require conditions', () => {
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.type).toBe('module');
    expect(pkg.exports['.'].import.default).toBe('./dist/index.js');
    expect(pkg.exports['.'].import.types).toBe('./dist/index.d.ts');
    expect(pkg.exports['.'].require.default).toBe('./dist/index.cjs');
    expect(pkg.exports['.'].require.types).toBe('./dist/index.d.cts');
    expect(pkg.files).toContain('LICENSE');
  });

  it('exports previously missing subpaths', () => {
    for (const key of ['./adapters', './migration-manager', './migration-dsl', './seed', './relations-resolver', './querykit', './engine', './sqlite', './postgres', './mysql', './oracle', './mssql', './memory']) {
      expect(pkg.exports[key]).toBeTruthy();
      expect(pkg.exports[key].require.default).toBeTruthy();
      expect(pkg.exports[key].require.types).toMatch(/\.d\.cts$/);
    }
  });

  it('declares real optional peer versions', () => {
    expect(pkg.peerDependencies['better-sqlite3']).toMatch(/^\^/);
    expect(pkg.peerDependencies.pg).toMatch(/^\^/);
    expect(pkg.peerDependencies.mysql2).toMatch(/^\^/);
    expect(pkg.repository.directory).toBeUndefined();
  });
});
