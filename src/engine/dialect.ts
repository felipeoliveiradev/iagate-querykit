export type SqlFragment = { sql: string; bindings: unknown[] };

export type CatalogQuery = {
  sql: string;
  bindings?: unknown[];
  map: (row: any) => string | undefined;
};

/** Bind outgoing values and hydrate incoming driver values. */
export interface TypeMapper {
  bind(value: unknown): unknown;
  hydrate(value: unknown): unknown;
}

/** Map a raw driver exception onto a stable QueryKit error code. */
export interface ErrorMapper {
  mapErrorCode(err: unknown): string;
}

export type DialectCapabilities = {
  fts5?: boolean;
  fullText?: boolean;
  json?: boolean;
  regex?: boolean;
  savepoints?: boolean;
  returning?: boolean;
  ilike?: boolean;
  arrays?: boolean;
  timezones?: boolean;
  windowFunctions?: boolean;
};

export type FullTextMode = 'match' | 'like' | 'auto';

export type FullTextOptions = {
  language?: string;
  mode?: FullTextMode;
};

export type ColumnTypeName =
  | 'int'
  | 'bigint'
  | 'float'
  | 'double'
  | 'decimal'
  | 'string'
  | 'text'
  | 'date'
  | 'time'
  | 'datetime'
  | 'timestamptz'
  | 'boolean'
  | 'json'
  | 'uuid'
  | 'binary';

/**
 * Dialect plugin. Core never switches on a dialect name; it asks this object.
 */
export interface Dialect {
  readonly name: string;
  readonly maxBindParams: number;
  readonly capabilities: DialectCapabilities;

  quoteIdent(name: string): string;
  quoteTableRef(ref: string): string;
  quoteSelectItem(item: string): string;

  applyPaging(
    sql: string,
    limit: number | undefined,
    offset: number | undefined,
    bindings: unknown[],
  ): string;
  returningInsertSql(sql: string, primaryKey?: string): string;
  toDriverParams(sql: string): { sql: string; paramNames?: string[] };

  iLikeSql(quotedColumn: string): string;
  jsonContains(quotedColumn: string, value: unknown): SqlFragment;
  fullText(
    quotedTable: string,
    quotedColumns: string[],
    rawColumns: string[],
    query: string,
    opts?: FullTextOptions,
  ): SqlFragment;
  findInSet(quotedColumn: string): string;
  arrayContains(quotedColumn: string): string;
  whereDate(quotedColumn: string, date: Date): SqlFragment;
  whereDateRangeTz(
    quotedColumn: string,
    start: Date,
    end: Date,
    timezone: string,
  ): SqlFragment;
  whereRegex(quotedColumn: string, pattern: string, flags: string): SqlFragment;
  radians(expr: string): string;

  beginSavepointSql(name: string): string;
  releaseSavepointSql(name: string): string | null;
  rollbackSavepointSql(name: string): string;

  migrationsTableSql(): string;
  listTriggersQueries(): CatalogQuery[];
  listViewsQueries(): CatalogQuery[];
  createTriggerSql(
    name: string,
    tableName: string,
    timing: string,
    event: string,
    body: string,
  ): string[];
  dropTriggerSql(name: string, tableName?: string): string;
  dropViewSql(viewName: string): string;
  dropTableSql(quotedName: string): string;
  dropIndexSql(quotedName: string): string;
  ifNotExistsClause(): string;
  ifExistsClause(): string;
  addColumnKeyword(): string;

  columnType(
    kind: ColumnTypeName,
    opts?: { length?: number; precision?: number; scale?: number },
  ): string;
  currentTimestampSql(): string;
  uuidV4Sql(): string;
  autoIncrementSql?(
    kind: ColumnTypeName,
    opts?: { mode?: string; start?: number; increment?: number },
  ): string | { replaceType?: string; suffix?: string; primaryKey?: boolean } | undefined;

  listColumnsQueries(quotedTable: string, rawTable: string): CatalogQuery[];

  bind(value: unknown): unknown;
  hydrate(value: unknown): unknown;
  mapErrorCode(err: unknown): string;
}
