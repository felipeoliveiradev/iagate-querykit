import type { Dialect } from './dialect.js';

const registry = new Map<string, Dialect>();

export function registerDialect(dialect: Dialect): void {
  if (!dialect?.name) throw new Error('registerDialect requires dialect.name');
  registry.set(dialect.name, dialect);
  if (dialect.name === 'postgres') registry.set('postgresql', dialect);
}

export function getDialect(name: string | Dialect | undefined): Dialect {
  if (name && typeof name === 'object' && typeof (name as Dialect).quoteIdent === 'function') {
    return name as Dialect;
  }
  const key = String(name || 'sqlite');
  const found = registry.get(key);
  if (!found) {
    throw new Error(
      `Unknown dialect '${key}'. Register it with registerDialect() or import the adapter module (e.g. 'iagate-querykit/postgres').`,
    );
  }
  return found;
}

export function tryGetDialect(name: string | undefined): Dialect | undefined {
  if (!name) return undefined;
  return registry.get(name);
}

export function listDialects(): string[] {
  return [...new Set(registry.values())].map((d) => d.name);
}

export function hasDialect(name: string): boolean {
  return registry.has(name);
}
