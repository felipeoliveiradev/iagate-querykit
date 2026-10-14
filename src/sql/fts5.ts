import type { DatabaseExecutor } from '../types.js';
import { UnsafeIdentifierError } from './errors.js';
import { splitIdent, wrapDouble } from '../engine/idents.js';

function quoteIdent(name: string): string {
  return splitIdent(name).map(wrapDouble).join('.');
}

function quoteTableRef(name: string): string {
  return quoteIdent(name);
}

function isSafeIdent(name: string): boolean {
  try {
    splitIdent(name);
    return true;
  } catch {
    return false;
  }
}

export type Fts5CreateOptions = {
  name: string;
  columns: string[];
  /** External content table (FTS5 `content=` option). */
  content?: string;
  contentRowid?: string;
  tokenize?: string;
  prefix?: string | number;
  unindexed?: string[];
};

function assertIdent(name: string, label: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed || !isSafeIdent(trimmed)) {
    throw new UnsafeIdentifierError(`Unsafe FTS5 ${label} '${name}'`);
  }
  return trimmed;
}

function sqlStringLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** `CREATE VIRTUAL TABLE … USING fts5(...)` */
export function fts5CreateSql(opts: Fts5CreateOptions): string {
  if (!opts?.columns?.length) {
    throw new Error('fts5CreateSql requires at least one column');
  }
  const name = quoteIdent(assertIdent(opts.name, 'table'));
  const unindexed = new Set((opts.unindexed || []).map((c) => assertIdent(c, 'column')));
  const cols = opts.columns.map((c) => {
    const ident = assertIdent(c, 'column');
    return unindexed.has(ident) ? `${ident} UNINDEXED` : ident;
  });
  const extras: string[] = [];
  if (opts.content) extras.push(`content=${sqlStringLiteral(assertIdent(opts.content, 'content table'))}`);
  if (opts.contentRowid) extras.push(`content_rowid=${sqlStringLiteral(assertIdent(opts.contentRowid, 'content_rowid'))}`);
  if (opts.tokenize) extras.push(`tokenize=${sqlStringLiteral(opts.tokenize)}`);
  if (opts.prefix != null) extras.push(`prefix=${sqlStringLiteral(String(opts.prefix))}`);
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING fts5(${[...cols, ...extras].join(', ')})`;
}

export function fts5DropSql(name: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(assertIdent(name, 'table'))}`;
}

/** Rebuild an external-content FTS5 index: `INSERT INTO fts(fts) VALUES('rebuild')`. */
export function fts5RebuildSql(name: string): string {
  const q = quoteIdent(assertIdent(name, 'table'));
  return `INSERT INTO ${q}(${q}) VALUES('rebuild')`;
}

/**
 * FTS5 MATCH query. When columns are given, uses the column filter
 * `{col1 col2}: query` so MATCH only searches those fields.
 */
export function fts5MatchQuery(columns: string[], query: string): string {
  const trimmed = String(query ?? '').trim();
  if (!columns.length) return trimmed;
  const cols = columns.map((c) => assertIdent(String(c), 'column')).join(' ');
  return `{${cols}}: ${trimmed}`;
}

export function fts5MatchSql(
  table: string,
  columns: string[],
  query: string,
): { sql: string; bindings: string[] } {
  return {
    sql: `${quoteTableRef(assertIdent(table, 'table'))} MATCH ?`,
    bindings: [fts5MatchQuery(columns, query)],
  };
}

/**
 * Triggers that keep a standalone FTS5 table in sync with a content table
 * (when `content=` is not used). For `content='…'` tables prefer `fts5RebuildSql`.
 */
export function fts5ContentSyncTriggersSql(
  ftsName: string,
  contentTable: string,
  columns: string[],
  contentRowid = 'rowid',
): string[] {
  if (!columns.length) throw new Error('fts5ContentSyncTriggersSql requires at least one column');
  const fts = quoteIdent(assertIdent(ftsName, 'table'));
  const content = quoteIdent(assertIdent(contentTable, 'table'));
  const rowid = assertIdent(contentRowid, 'content_rowid');
  const cols = columns.map((c) => quoteIdent(assertIdent(c, 'column'))).join(', ');
  const newCols = columns.map((c) => `new.${quoteIdent(assertIdent(c, 'column'))}`).join(', ');
  const ai = quoteIdent(assertIdent(`${ftsName}_ai`, 'trigger'));
  const ad = quoteIdent(assertIdent(`${ftsName}_ad`, 'trigger'));
  const au = quoteIdent(assertIdent(`${ftsName}_au`, 'trigger'));
  return [
    `CREATE TRIGGER IF NOT EXISTS ${ai} AFTER INSERT ON ${content} BEGIN INSERT INTO ${fts}(rowid, ${cols}) VALUES (new.${rowid}, ${newCols}); END`,
    `CREATE TRIGGER IF NOT EXISTS ${ad} AFTER DELETE ON ${content} BEGIN INSERT INTO ${fts}(${fts}, rowid) VALUES ('delete', old.${rowid}); END`,
    `CREATE TRIGGER IF NOT EXISTS ${au} AFTER UPDATE ON ${content} BEGIN INSERT INTO ${fts}(${fts}, rowid) VALUES ('delete', old.${rowid}); INSERT INTO ${fts}(rowid, ${cols}) VALUES (new.${rowid}, ${newCols}); END`,
  ];
}

export async function createFts5VirtualTable(
  exec: DatabaseExecutor,
  opts: Fts5CreateOptions,
): Promise<void> {
  const sql = fts5CreateSql(opts);
  if (exec.run) await exec.run(sql, []);
  else if (exec.runSync) exec.runSync(sql, []);
  else await exec.executeQuery(sql, []);
}

export async function rebuildFts5Index(exec: DatabaseExecutor, name: string): Promise<void> {
  const sql = fts5RebuildSql(name);
  if (exec.run) await exec.run(sql, []);
  else if (exec.runSync) exec.runSync(sql, []);
  else await exec.executeQuery(sql, []);
}
