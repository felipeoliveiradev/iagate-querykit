import { QueryBuilder } from './query-builder.js';
import { QueryKitConfig } from './config.js';
import type { RelationDefinition, RelationsRegistry } from './types.js';

export { setRelations } from './config.js';

type Selector = (rel: (name: string, select?: string[]) => void) => void;

const MAX_DEPTH = 4;

function wantedMap(
  selector?: Selector,
): Record<string, string[] | undefined> | 'ALL' {
  if (!selector) return 'ALL';
  const tmp: Record<string, string[] | undefined> = {};
  selector((name, select) => {
    tmp[name] = select;
  });
  return tmp;
}

function applySelect(
  qb: QueryBuilder<any>,
  columns?: string[],
  required: string[] = [],
): QueryBuilder<any> {
  if (columns && columns.length) {
    const extra = required.filter((c) => !columns.includes(c));
    qb.select([...columns, ...extra]);
  }
  return qb;
}

function stripUnselected(rows: any[], select?: string[], required: string[] = []): void {
  if (!select || !select.length) return;
  const keep = new Set(select);
  for (const key of required) {
    if (keep.has(key)) continue;
    for (const row of rows) delete row[key];
  }
}

function uniqueNonNull(values: unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const v of values) {
    if (v === undefined || v === null) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Eager-load relations registered via `setRelations`.
 * Batches with `whereIn` (one query per relation, not per row) and can
 * recurse into nested tables up to MAX_DEPTH.
 */
export async function attachRelations(
  table: string,
  rows: any[],
  selector?: Selector,
  depth = 0,
  stack: string[] = [],
): Promise<any[]> {
  if (!rows || rows.length === 0) return rows;
  if (depth > MAX_DEPTH) return rows;
  if (stack.includes(table)) return rows;

  const registry: RelationsRegistry = QueryKitConfig.relations || {};
  const defs = registry[table] || [];
  if (defs.length === 0) return rows;

  const wanted = wantedMap(selector);
  const nextStack = [...stack, table];

  for (const def of defs) {
    if (wanted !== 'ALL' && !(def.name in wanted)) continue;
    const select = wanted === 'ALL' ? undefined : wanted[def.name];
    const related = await loadRelation(def, rows, select);
    if (related.length && depth < MAX_DEPTH) {
      await attachRelations(def.table, related, undefined, depth + 1, nextStack);
    }
  }
  return rows;
}

async function loadRelation(
  def: RelationDefinition,
  rows: any[],
  select?: string[],
): Promise<any[]> {
  if (def.kind === 'hasMany') return loadHasMany(def, rows, select);
  if (def.kind === 'belongsTo') return loadBelongsTo(def, rows, select);
  if (def.kind === 'manyToMany' && def.through) return loadManyToMany(def, rows, select);
  for (const r of rows) {
    if (r[def.name] === undefined) r[def.name] = [];
  }
  return [];
}

async function loadHasMany(def: RelationDefinition, rows: any[], select?: string[]): Promise<any[]> {
  const localKey = def.localKey || 'id';
  const fk = def.foreignKey || 'id';
  const byLocal = new Map<unknown, any[]>();
  for (const r of rows) {
    r[def.name] = [];
    const key = r[localKey];
    const bucket = byLocal.get(key);
    if (bucket) bucket.push(r);
    else byLocal.set(key, [r]);
  }
  const ids = uniqueNonNull(rows.map((r) => r[localKey]));
  if (!ids.length) return [];
  const children = await applySelect(new QueryBuilder<any>(def.table).whereIn(fk, ids), select, [fk]).all();
  for (const c of children) {
    const parents = byLocal.get(c[fk]);
    if (!parents) continue;
    for (const parent of parents) parent[def.name].push(c);
  }
  stripUnselected(children, select, [fk]);
  return children;
}

async function loadBelongsTo(def: RelationDefinition, rows: any[], select?: string[]): Promise<any[]> {
  const foreignKey = def.foreignKey || 'id';
  const ownerKey = def.ownerKey || 'id';
  const fks = uniqueNonNull(rows.map((r) => r[foreignKey]));
  for (const r of rows) r[def.name] = null;
  if (!fks.length) return [];
  const parents = await applySelect(
    new QueryBuilder<any>(def.table).whereIn(ownerKey, fks),
    select,
    [ownerKey],
  ).all();
  const parentByKey = new Map<unknown, any>(parents.map((p: any) => [p[ownerKey], p]));
  for (const r of rows) r[def.name] = parentByKey.get(r[foreignKey]) ?? null;
  stripUnselected(parents, select, [ownerKey]);
  return parents;
}

async function loadManyToMany(def: RelationDefinition, rows: any[], select?: string[]): Promise<any[]> {
  const localKey = def.localKey || 'id';
  const ownerKey = def.ownerKey || 'id';
  const join = def.through!.table;
  const leftKey = def.through!.leftKey;
  const rightKey = def.through!.rightKey;
  for (const r of rows) r[def.name] = [];
  const ids = uniqueNonNull(rows.map((r) => r[localKey]));
  if (!ids.length) return [];
  const links = await new QueryBuilder<any>(join).whereIn(leftKey, ids).all();
  const rightIds = uniqueNonNull(links.map((l: any) => l[rightKey]));
  const rights = rightIds.length
    ? await applySelect(
        new QueryBuilder<any>(def.table).whereIn(ownerKey, rightIds),
        select,
        [ownerKey],
      ).all()
    : [];
  const rightById = new Map<unknown, any>(rights.map((x: any) => [x[ownerKey], x]));
  const bucket = new Map<unknown, any[]>();
  for (const l of links) {
    const arr = bucket.get(l[leftKey]) || [];
    const item = rightById.get(l[rightKey]);
    if (item) arr.push(item);
    bucket.set(l[leftKey], arr);
  }
  for (const r of rows) r[def.name] = bucket.get(r[localKey]) || [];
  stripUnselected(rights, select, [ownerKey]);
  return rights;
}
