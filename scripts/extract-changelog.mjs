#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section for a semver (the `## X.Y.Z` heading
 * through the line before the next `## `). Used by publish-if-new.sh
 * for the GitHub Release notes. Never prints secrets.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

export function extractChangelogSection(markdown, version) {
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error('version must look like X.Y.Z');
  }
  const lines = String(markdown).split(/\r?\n/);
  const header = `## ${version}`;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === header) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    throw new Error(`CHANGELOG.md has no "${header}" section`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+\d/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return `${lines.slice(start, end).join('\n').trim()}\n`;
}

function main() {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write('usage: node scripts/extract-changelog.mjs <version>\n');
    process.exit(2);
  }
  const md = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  process.stdout.write(extractChangelogSection(md, version));
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) main();
