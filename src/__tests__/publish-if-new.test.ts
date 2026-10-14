import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractChangelogSection } from '../../scripts/extract-changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const publishSh = readFileSync(join(root, 'scripts/publish-if-new.sh'), 'utf8');
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

describe('publish-if-new (fiboui lessons)', () => {
  it('reads version/name with single-quoted node -p (no nested node -e quotes)', () => {
    expect(publishSh).toMatch(/VERSION="\$\(node -p 'require\("\.\/package\.json"\)\.version'\)"/);
    expect(publishSh).toMatch(/NAME="\$\(node -p 'require\("\.\/package\.json"\)\.name'\)"/);
    expect(publishSh).not.toMatch(/node -e "/);
    expect(workflow).not.toMatch(/VERSION="\$\(node -e/);
    expect(workflow).toMatch(/bash scripts\/publish-if-new\.sh/);
  });

  it('pins repository.url so provenance does not E422', () => {
    expect(pkg.repository.url).toBe('git+https://github.com/felipeoliveiradev/iagate-querykit.git');
    expect(pkg.repository.directory).toBeUndefined();
    expect(publishSh).toContain('git+https://github.com/felipeoliveiradev/iagate-querykit.git');
  });

  it('1.0.0 is greater than published 0.1.46 and has a CHANGELOG section', () => {
    expect(pkg.version).toBe('1.0.0');
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    expect(maj).toBeGreaterThanOrEqual(1);
    expect(min + pat).toBeGreaterThanOrEqual(0);
    const notes = extractChangelogSection(changelog, pkg.version);
    expect(notes).toMatch(/^## 1\.0\.0\n/);
    expect(notes.length).toBeGreaterThan(80);
  });
});
