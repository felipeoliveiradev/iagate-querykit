import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyFinding, scanText } from '../../scripts/secret-scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('secret-scan', () => {
  it('classifies throwaway / docs / rejection fixtures as allowlisted', () => {
    expect(classifyFinding('connection_string', 'postgres://querykit:querykit@127.0.0.1:5432/qk_e_1')).toBe(
      'allow_loopback',
    );
    expect(classifyFinding('connection_string', 'postgres://user:pass@localhost:5432/app')).toBe('allow_loopback');
    expect(classifyFinding('connection_string', 'postgres://app:secret@prod-db.internal:5432/app')).toBe(
      'allow_rejection_fixture',
    );
    expect(classifyFinding('connection_string', 'mysql://user:pass@10.1.2.3:3306/app')).toBe('allow_rejection_fixture');
    expect(classifyFinding('aws_access_key', 'AKIAIOSFODNN7EXAMPLE')).toBe('allow_aws_example');
  });

  it('flags a non-example npm token pattern without echoing it', () => {
    const token = ['npm', '_', 'PLACEHOLDERTOKENVALUE00'].join('');
    const assignment = ['_auth', 'Token='].join('') + token;
    const hits = scanText(`registry=https://registry.npmjs.org\n${assignment}`);
    expect(hits.some((h) => h.type === 'npmrc_auth' && h.classification === 'review')).toBe(true);
    expect(JSON.stringify(hits)).not.toContain(token);
  });

  it('repo has gitleaks config, SECURITY.md, and a clean scan', () => {
    expect(existsSync(join(root, '.gitleaks.toml'))).toBe(true);
    expect(existsSync(join(root, 'SECURITY.md'))).toBe(true);
    expect(readFileSync(join(root, '.npmrc'), 'utf8').trim()).toBe('legacy-peer-deps=true');
    const res = spawnSync(process.execPath, [join(root, 'scripts/secret-scan.mjs')], {
      encoding: 'utf8',
      cwd: root,
    });
    expect(res.status, res.stderr || res.stdout).toBe(0);
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/npm_[A-Za-z0-9]{20,}/);
  });
});
