# Adding a database to QueryKit

QueryKit’s core (`QueryBuilder`, compiler, relations, migrations) talks only to
abstractions. Adding a new engine is **plugging in a module**. You do not edit
`src/query-builder.ts`, `src/sql/compile.ts`, or the managers.

```
createQueryKit({ dialect, driver })
        │
        ▼
   QueryBuilder  ──►  Dialect (quoting, paging, FTS, dates, DDL, bind/hydrate)
        │
        ▼
   Driver / DatabaseExecutor  ──►  native client (peer dependency)
```

## 1. Create a dialect module

A dialect is a `Dialect` object. Use `defineDialect()` for defaults
(LIMIT/OFFSET, LIKE fallbacks, sqlite-shaped catalogs) and override what
differs.

```ts
// src/dialects/duckdb/index.ts  (your package, or a folder in this repo)
import { defineDialect, limitOffsetPaging, likeFullText } from 'iagate-querykit/engine';
import { registerDialect } from 'iagate-querykit/engine';
import { makeQuoter } from 'iagate-querykit'; // or copy makeQuoter from dialects/quoting
import { wrapDouble } from 'iagate-querykit/engine';

const q = makeQuoter(wrapDouble);

export const duckdbDialect = defineDialect({
  name: 'duckdb',
  maxBindParams: 65535,
  capabilities: {
    fts5: false,
    json: true,
    regex: true,
    savepoints: true,
    returning: true,
  },
  ...q,
  applyPaging: (sql, limit, offset, bindings) =>
    limitOffsetPaging(sql, limit, offset, bindings),
  returningInsertSql: (sql) =>
    /^\s*insert\b/i.test(sql) ? `${sql.replace(/;?\s*$/, '')} RETURNING *` : sql,
  iLikeSql: (col) => `${col} ILIKE ?`,
  fullText: (_t, cols, _r, query) => likeFullText(cols, query),
  types: {
    int: 'INTEGER',
    bigint: 'BIGINT',
    string: (o) => `VARCHAR(${o.length || 255})`,
    text: 'TEXT',
    json: 'JSON',
    boolean: 'BOOLEAN',
    datetime: 'TIMESTAMP',
    // …see ColumnTypeName
  },
});

registerDialect(duckdbDialect);
export default duckdbDialect;
```

Required surface (see `src/engine/dialect.ts`):

| Group | Methods |
| --- | --- |
| Quoting | `quoteIdent`, `quoteTableRef`, `quoteSelectItem` |
| SQL shape | `applyPaging`, `returningInsertSql`, `toDriverParams` |
| Predicates | `iLikeSql`, `jsonContains`, `fullText`, `findInSet`, `arrayContains`, `whereDate`, `whereDateRangeTz`, `whereRegex`, `radians` |
| Tx | `beginSavepointSql`, `releaseSavepointSql`, `rollbackSavepointSql` |
| DDL / catalogs | `migrationsTableSql`, `listTriggersQueries`, `listViewsQueries`, `listColumnsQueries`, `createTriggerSql`, `dropTriggerSql`, `dropViewSql`, `dropTableSql`, `dropIndexSql`, `ifNotExistsClause`, `ifExistsClause`, `addColumnKeyword` |
| Types | `columnType`, `currentTimestampSql`, `uuidV4Sql`, optional `autoIncrementSql` |
| Mapping | `bind`, `hydrate`, `mapErrorCode` |

Capability flags (`capabilities.fts5`, `regex`, `returning`, …) document optional
features. If a feature is impossible, throw `UnsupportedFeatureError` from the
method (see `memoryDialect.whereRegex`).

## 2. Create a driver (executor)

Implement `DatabaseExecutor`:

```ts
export class DuckdbExecutor implements DatabaseExecutor {
  readonly dialect = 'duckdb' as const; // or any string; the Dialect object is the source of SQL
  async executeQuery(sql: string, bindings: unknown[] = []) { /* wrap in DriverError */ }
  async run(sql: string, bindings: unknown[] = []) { /* … */ }
  async transaction(fn) { /* BEGIN / savepoints via dialect.beginSavepointSql */ }
  close() { /* … */ }
}
```

Wrap every native throw with `toDriverError` / `wrapDriverCall` so callers get
`DriverError` (`cause`, `driverCode`, `sql`, redacted `params`).

Declare the native client as an **optional peer** (`duckdb`, `libsql`, …).

## 3. Export a subpath

```json
"exports": {
  "./duckdb": {
    "import": { "types": "./dist/duckdb.d.ts", "default": "./dist/duckdb.js" },
    "require": { "types": "./dist/duckdb.d.cts", "default": "./dist/duckdb.cjs" }
  }
}
```

```ts
// src/duckdb.ts
import './dialects/duckdb/index.js';
export { duckdbDialect } from './dialects/duckdb/index.js';
export { DuckdbExecutor } from './adapters/duckdb.js';
```

Consumers:

```ts
import { createQueryKit } from 'iagate-querykit';
import { duckdbDialect, DuckdbExecutor } from 'iagate-querykit/duckdb';

const kit = createQueryKit({
  dialect: duckdbDialect,
  driver: new DuckdbExecutor({ path: ':memory:' }),
});
```

No global singleton. `QueryKitConfig.defaultExecutor` remains a legacy fallback.

## 4. Pass conformance

```ts
import { runDialectConformance } from 'iagate-querykit/engine';

await runDialectConformance({ dialect: duckdbDialect });
await runDialectConformance({ dialect: duckdbDialect, driver: new DuckdbExecutor({ path: ':memory:' }) });
```

Compile-time checks always run. Pass `driver` only against a **throwaway**
loopback or in-memory database. Never point conformance (or any QueryKit test)
at a real/company database.

## 5. Minimal in-repo example

`src/dialects/memory/index.ts` + `src/memory.ts` (`iagate-querykit/memory`) is a
working extra dialect. It reuses SQLite-shaped SQL and pairs with
`BetterSqlite3Executor(':memory:')`. The test
`src/__tests__/dialect-conformance.test.ts` registers a one-off `toy` dialect
and runs queries **without any core file change**.

## FTS modes

`whereFullText(columns, query, language | { language, mode })`

| mode | Behavior |
| --- | --- |
| `match` | Native FTS (`MATCH` / `to_tsvector` / `MATCH AGAINST` / `CONTAINS`). Fail if the engine cannot run it. |
| `like` | Portable `col LIKE ?` (`%query%`). Opt-in when there is no virtual table. |
| `auto` | Default on SQLite (`capabilities.fts5`). Compile `MATCH`; if the driver reports no FTS table/module, retry with `LIKE`. |

## Big integers

`BetterSqlite3Executor` enables `defaultSafeIntegers` unless you pass
`{ safeIntegers: false }`. Values that fit in `Number.MAX_SAFE_INTEGER` hydrate
back to `number` so existing `toBe(1)` assertions stay valid. Values outside
that range stay `bigint`.

## Checklist for a new adapter

1. Dialect module + `registerDialect(dialect)` on import.
2. Driver wrapping every native error in `DriverError`.
3. Subpath export + optional peer.
4. `runDialectConformance({ dialect })` and a live throwaway run.
5. No edits under `src/query-builder.ts`, `src/sql/compile.ts`, managers.
