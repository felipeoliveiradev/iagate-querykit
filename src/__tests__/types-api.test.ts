import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('public types (D9, T6)', () => {
  it('does not advertise unimplemented database engines', () => {
    const src = readFileSync(join(root, 'src/database-adapters/base-adapter.ts'), 'utf8');
    expect(src).not.toMatch(/mongodb|redis|firebase|hadoop|spark/);
  });

  it('shares QueryResult from src/types.ts', () => {
    const src = readFileSync(join(root, 'src/database-adapters/base-adapter.ts'), 'utf8');
    expect(src).toMatch(/export type \{ QueryResult \}/);
  });
});
