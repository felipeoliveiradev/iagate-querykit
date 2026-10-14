import { createRequire } from 'node:module';
import type { QueryResult, WriteResult } from '../types.js';

export function loadOptionalPeer(packageName: string, mockKey: string): any {
  const mocked = (globalThis as any).__vitest_mocks__?.[mockKey];
  if (mocked) return mocked;
  const req = createRequire(import.meta.url);
  try {
    return req(packageName);
  } catch {
    throw new Error(`${packageName} is required: npm install ${packageName}`);
  }
}

export function asWrite(res: QueryResult): WriteResult {
  return {
    changes: res.affectedRows ?? 0,
    lastInsertRowid: (res.lastInsertId as any) ?? 0,
  };
}
