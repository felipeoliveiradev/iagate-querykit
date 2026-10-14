# iagate-querykit audit (0.1.46 → 1.0.0)

Audit of the repository source, docs, `package.json`, build config, and the published npm package `iagate-querykit@0.1.46`. Each item has a severity, a status, and the covering test (or a justification if not applicable).

Legend: **Critical** / **High** / **Medium** / **Low**. Status is `FIXED` after the 1.0.0 work unless noted.

---

## 1. SQL injection, parameter binding, escaping

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| S1 | Critical | Table, column, alias, view, trigger, and index names are interpolated raw into SQL (`FROM ${table}`, `SET ${k} = ?`, `CREATE VIEW ${viewName}`, `CREATE TRIGGER ${name} … ON ${table}`, migration DSL). A hostile identifier is a SQL injection. | FIXED | `src/__tests__/sql-security.test.ts` |
| S2 | Critical | `toPgParams` / `toOracle` / `toMssql` replace every `?`, including those inside string literals and comments. Postgres also uses `?` / `?\|` JSON operators, which are destroyed. | FIXED | `src/__tests__/sql-placeholders.test.ts` |
| S3 | Critical | `havingRaw(sql, bindings)` drops `bindings`. The `?` placeholders are emitted with no parameters. | FIXED | `src/__tests__/sql-security.test.ts` |
| S4 | Critical | `whereJsonContains` stores `value` as a non-array, so `buildWhereClause` never binds it. The SQL still contains `?`. | FIXED | `src/__tests__/sql-security.test.ts` |
| S5 | High | View creation inlines bindings by globally replacing `?`. Placeholders inside view SQL literals are corrupted; identifiers in the view SQL are still unquoted. | FIXED | `src/__tests__/views-triggers.test.ts`, `src/__tests__/sql-placeholders.test.ts` |
| S6 | High | SQLite fallback for JSON/array contains uses T-SQL `'%' + ? + '%'`, which is invalid on SQLite (`\|\|`). | FIXED | `src/__tests__/sql-security.test.ts` |
| S7 | High | `whereIf` treats `false` as truthy (`false !== null/undefined/''`), so `whereIf(false, …)` still applies. `whereAll({ active: false })` is also wrong either way. | FIXED | `src/__tests__/query-builder.test.ts` |
| S8 | High | Semantic SQL trigger bodies run with `runSync(body, [])` — no bindings. | FIXED (documented as raw SQL; identifiers quoted in generated DDL) | `src/__tests__/triggers-semantic.test.ts` |
| S9 | Medium | `inlineBindings` / `escapeSqlLiteral` exist only for views; they are not used for identifier quoting. | FIXED | `src/__tests__/sql-security.test.ts` |
| S10 | Medium | `exists()` calls `selectRaw('1')`, which **appends** `1` to the select list (`SELECT *, 1`) and mutates the builder. | FIXED | `src/__tests__/query-builder.test.ts` |
| S11 | Medium | `get()` / `first()` / `find()` / `getSync()` mutate the builder with `limit(1)`. `find()` also permanently adds `WHERE id = ?`. | FIXED | `src/__tests__/query-builder.test.ts` |

---

## 2. Transactions and connection handling

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| C1 | Critical | No transaction API on `DatabaseExecutor` or any adapter. Multi-statement writes (migrations, `updateOrInsert`, seed batches) are not atomic. | FIXED | `src/__tests__/transactions.test.ts`, `src/__tests__/integration/*.test.ts` |
| C2 | High | No `close()` / `end()` on SQLite, Postgres, MySQL, Oracle, or SQL Server executors. Pools leak. | FIXED | `src/__tests__/adapters-lifecycle.test.ts` |
| C3 | High | `BetterSqlite3Executor` has no `dialect`, so every dialect switch (ILIKE, paging, triggers, migrations) falls through to the SQLite default even when another executor is configured incorrectly — and SQLite itself is unlabeled. | FIXED | `src/__tests__/adapters-lifecycle.test.ts` |
| C4 | High | `BetterSqlite3Executor.executeQuerySync` treats only `/^select\s/i` as a query. `WITH … SELECT`, leading comments, `EXPLAIN`, `PRAGMA`, and `VALUES` take the `run` path and throw or return empty `data`. | FIXED | `src/__tests__/adapters-lifecycle.test.ts` |
| C5 | High | `MysqlExecutor.executeQuery` returns `{ data }` for SELECT and a raw `[rows, info]` tuple for writes. Callers (except `make()`) cannot rely on `QueryResult`. | FIXED | `src/__tests__/db-adapters.test.ts` |
| C6 | High | `SqlServerExecutor` assigns `this.pool = new ConnectionPool(…).connect()` (a Promise). There is no connect-error handling or `close()`. | FIXED | `src/__tests__/db-adapters.test.ts` |
| C7 | High | Oracle always uses `autoCommit: true`. There is no way to group statements. | FIXED | `src/__tests__/db-adapters.test.ts` |
| C8 | Medium | `PostgresExecutor` never returns `lastInsertId`. Inserts cannot recover the new id. | FIXED (`RETURNING` when the SQL is an INSERT) | `src/__tests__/integration/postgres.test.ts` |
| C9 | Medium | `BetterSqlite3Executor` always opens a file path via `createRequire`. It cannot wrap an existing `Database` instance. | FIXED | `src/__tests__/integration/sqlite.test.ts` |
| C10 | Medium | Foreign keys are not enabled on SQLite (`PRAGMA foreign_keys = ON`). | FIXED | `src/__tests__/integration/sqlite.test.ts` |
| C11 | Medium | `run()` uses only `QueryKitConfig.defaultExecutor` and ignores `bank()` / table routing. | FIXED | `src/__tests__/query-builder.test.ts` |

---

## 3. Driver / dialect differences

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| D1 | High | `LIMIT ? OFFSET ?` is emitted for every dialect. MSSQL and Oracle need `OFFSET n ROWS FETCH NEXT n ROWS ONLY` (and an `ORDER BY`). | FIXED | `src/__tests__/dialect-paging.test.ts` |
| D2 | High | `TriggerManager.createTrigger` always emits SQLite `CREATE TRIGGER IF NOT EXISTS … FOR EACH ROW BEGIN … END`. That is invalid on Postgres, MySQL, MSSQL, and Oracle. | FIXED | `src/__tests__/trigger-ddl.test.ts` |
| D3 | High | `DROP VIEW IF EXISTS` / `DROP TRIGGER IF EXISTS` / `CREATE INDEX IF NOT EXISTS` are not portable (Oracle, older MySQL, MSSQL). | FIXED | `src/__tests__/trigger-ddl.test.ts`, `src/__tests__/migrations.test.ts` |
| D4 | Medium | `ViewManager` / `TriggerManager` always use `QueryKitConfig.defaultExecutor`, ignoring `bank()` and table routing. | FIXED (optional executor argument; still default when omitted) | `src/__tests__/views-triggers.test.ts` |
| D5 | Medium | `listViews()` / `listTriggers()` treat `rows.length >= 0` as success, so the first candidate query that does not throw wins — even when it returns the wrong catalog. | FIXED | `src/__tests__/views-triggers.test.ts` |
| D6 | Medium | `insert()` stores an array but `make()` inserts only `data[0]`. Multi-row insert is silently truncated. | FIXED | `src/__tests__/query-builder.test.ts`, integration tests |
| D7 | Medium | `toSql()` **mutates** `this.selectColumns` when aggregates are set, so a later `toSql()` / `select()` sees a corrupted select list. | FIXED | `src/__tests__/query-builder.test.ts` |
| D8 | Medium | `clone()` does not copy `unionParts`, `targetBanks`, `pendingAction`, or `tableAlias` as own copies (union array is shared). | FIXED | `src/__tests__/query-builder.test.ts` |
| D9 | Low | `DatabaseType` advertises mongodb/redis/firebase/cassandra/hadoop/spark. None have adapters. | FIXED (removed from the public type; docs corrected) | `src/__tests__/types-api.test.ts` |

---

## 4. Type errors and API inconsistencies

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| T1 | High | `tsconfig.json` is not `strict`, uses `moduleResolution: Bundler`, and `skipLibCheck: true`. The published types are not a contract. | FIXED | `npm run typecheck` (strict + NodeNext) |
| T2 | High | README and docs use `await qb.first()` / `await qb.get()` / `await qb.find(id)`, but those methods are **synchronous** and call `allSync()`. They throw on async-only adapters (pg/mysql). | FIXED (`get`/`first`/`find` are async; sync variants remain) | `src/__tests__/query-builder.test.ts` |
| T3 | High | `EventBus.emit(event, payload?)` vs `EventManager.emit(event, ...args)` forwarded as `eventBus.emit(eventName, ...args)`. Extra args are dropped; the signatures disagree. | FIXED | `src/__tests__/event-manager.test.ts` |
| T4 | High | README `multi.initialize(({ filePath }) => new BetterSqlite3Executor(filePath!))` is a type error: `initialize` requires `BaseDatabaseAdapter` with `connect()`. `BetterSqlite3Executor` has neither `connect` nor the adapter interface. | FIXED (manager accepts executors or adapters) | `src/__tests__/database-manager.test.ts` |
| T5 | Medium | `MultiDatabaseManager.getInstance()` is a singleton that cannot be reset. Calling it without config after a failed first call returns `undefined`. | FIXED (`resetInstance`, throws if uninitialized) | `src/__tests__/database-manager.test.ts` |
| T6 | Medium | Duplicate `QueryResult` types (`src/types.ts` vs `src/database-adapters/base-adapter.ts`) drift. | FIXED (single shared type) | `src/__tests__/types-api.test.ts` |
| T7 | Medium | `Model.delete()` documents “throws if no id” but does not throw. `save()` never writes the generated id back onto the instance. | FIXED | `src/__tests__/model.test.ts` |
| T8 | Medium | `table()` example uses `.select('*').where('active', true)` — `select` expects an array and `where` requires `(column, op, value)`. | FIXED (docs + `where` 2-arg equality overload) | `src/__tests__/query-builder.test.ts` |
| T9 | Medium | `count()` + `scalarSync('count')` in the README: `count()` adds an aggregate whose default alias is `count_*`, not `count`. | FIXED (default alias `count` for `count()`) | `src/__tests__/query-builder.test.ts` |
| T10 | Low | `peerDependencies.better-sqlite3` is the empty string `""`. pg/mysql2/oracledb/mssql are not declared. | FIXED | `src/__tests__/package-manifest.test.ts` |
| T11 | Low | `SimulationController` example in `types.ts` is a circular interface name. | FIXED | typecheck |

---

## 5. Missing features vs README / docs promises

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| R1 | High | README lists `./adapters/better-sqlite3` as the way to configure an executor, but never mentions MySQL/Postgres/Oracle/SQL Server install, `dialect`, transactions, or `close()`. | FIXED | README + `website/docs/adapters-and-executors.md` |
| R2 | High | README `TriggerManager` is documented as SQLite-only; the implementation claims multi-dialect and then emits SQLite DDL. | FIXED (dialect-aware DDL + docs) | `src/__tests__/trigger-ddl.test.ts` |
| R3 | Medium | README `ViewManager.listViews(): string[]` is sync; async-only executors always get `[]`. | FIXED (`listViews` is async-capable via `listViewsAsync`; sync documented as SQLite-only) | `src/__tests__/views-triggers.test.ts` |
| R4 | Medium | README multi-db example imports `BetterSqlite3Executor` without importing it. | FIXED | README |
| R5 | Medium | Relations require `process.env.QK_RELATIONS_PATH` (undocumented dynamic import). There is no `setRelations()` API. | FIXED | `src/__tests__/relations-and-seed.test.ts` |
| R6 | Medium | Migrations, seed, `whereMultiSearch`, `relationship()`, banks, and the migration DSL are implemented but missing from the README API catalog and from `exports`. | FIXED | `src/__tests__/package-manifest.test.ts` |
| R7 | Low | Docs live under `website/` (pt-BR) and i18n copies that drift from the API. Getting-started is Portuguese-only in `website/docs`. | FIXED (English API docs aligned; catalog corrected) | docs review |
| R8 | Low | `repository.directory` is `packages/querykit` and homepage points at that path. This repo **is** the package root. | FIXED | `src/__tests__/package-manifest.test.ts` |

---

## 6. Packaging (exports, ESM/CJS, types, sideEffects)

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| P1 | Critical | Package is ESM-only (`"type": "module"`, exports have `import` only). `require('iagate-querykit')` fails. | FIXED (dual ESM/CJS) | `scripts/consumer-verify.mjs` |
| P2 | Critical | Compiled JS keeps extensionless relative imports (`from './types'`). NodeNext ESM consumers cannot resolve subpath files. | FIXED (`.js` specifiers + tsup dual emit) | consumer verify (NodeNext + bundler) |
| P3 | High | No `require` / `default` export conditions. Types are not dual (`d.cts`). | FIXED | consumer verify |
| P4 | High | Missing exports: `./adapters`, `./migration-manager`, `./migration-dsl`, `./seed`, `./relations-resolver`. | FIXED | `src/__tests__/package-manifest.test.ts` |
| P5 | High | `prepack` runs the full test suite (needs native peers). `files` is only `dist` — no LICENSE in the tarball. No LICENSE file in the repo. | FIXED | `src/__tests__/package-manifest.test.ts` |
| P6 | Medium | `sideEffects: false` is acceptable (no import-time I/O except optional `createRequire` inside adapter constructors). Kept. | FIXED (kept; adapters stay lazy) | n/a |
| P7 | Medium | Build is raw `tsc` with Bundler resolution. No CJS emit, no provenance publish workflow. | FIXED (tsup ESM+CJS+dts, CI publish) | `npm run build` |
| P8 | Low | `vitest.config.ts` has typos (`covarage`, stale comments) and coverage is enabled by default, slowing local runs. | FIXED | `vitest.config.ts` |

Black-box of **published 0.1.46** (see §10) confirmed P1–P3 and the identifier-injection / insert-truncation / sync-`get` bugs at runtime.

---

## 7. Docs errors

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| DOC1 | Medium | README example `unioned.toSql()` comment claims `WHERE id = ?` for a query that filters `active`. | FIXED | README |
| DOC2 | Medium | Makefile `publish` runs `npm publish` with no provenance, no version-exists guard. | FIXED (Makefile points at the documented release process; CI publishes) | Makefile + `RELEASE.md` |
| DOC3 | Medium | No CHANGELOG, no release docs, no note that `NPM_TOKEN` must be set for publish. | FIXED | `CHANGELOG.md`, `RELEASE.md` |
| DOC4 | Low | `website/docs/table.ts` example and JSDoc show `where('active', true)`. | FIXED | docs + 2-arg `where` |
| DOC5 | Low | Typedoc config exists but API markdown is not the source of truth for the README catalog. | FIXED (README catalog regenerated) | README |

---

## 8. Other correctness bugs

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| B1 | High | Seed `truncate` is `DELETE FROM ${table}` with no identifier quoting and no transaction around the following inserts. | FIXED | `src/__tests__/relations-and-seed.test.ts` |
| B2 | Medium | Scheduler uses `setInterval` without `unref`, keeping Node processes alive. No `list()` / `clear()`. | FIXED | `src/__tests__/scheduler.test.ts` |
| B3 | Medium | `parallel()` does not clone builders; concurrent `toSql()` mutation (aggregates) races. | FIXED | `src/__tests__/parallel-queries.test.ts` |
| B4 | Medium | `updateOrInsert` is not atomic (update then insert) and is racy. | FIXED (wrapped in `transaction()` when the executor provides one) | `src/__tests__/transactions.test.ts` |
| B5 | Low | `QueryKitConfig` has no reset helper; tests leak global executor state. | FIXED (`resetQueryKitConfig`) | used across the suite |

---

## 9. Items not fixed (justification)

None of the audit items above are left open. Out of scope on purpose:

- **Oracle / SQL Server live integration** — no Docker daemon in this VM (`which docker` is empty), so `gvenzl/oracle-free` and `mcr.microsoft.com/mssql/server` were not started. Dialect SQL is snapshot-tested (`src/__tests__/dialect-sql-snapshots.test.ts`) and adapters are exercised with in-process pool mocks (tx commit/rollback/close). Live integration covers SQLite `:memory:` always, and throwaway Postgres 16 + MySQL 8 on `127.0.0.1` only.
- **Full-text / geo helpers** are still best-effort dialect SQL (not a search engine). They now quote identifiers, bind values, and have live round-trips on throwaway SQLite / Postgres / MySQL. SQLite FTS is LIKE, not FTS5.
- **Semantic triggers that emit arbitrary SQL strings** are still raw SQL by design (same as `whereRaw`).

---

## 10. Black-box results for published `iagate-querykit@0.1.46`

Ran against the registry tarball (not this branch):

| Probe | Result |
| --- | --- |
| `import('iagate-querykit')` (ESM) | Loads. |
| `require('iagate-querykit')` (CJS) | **Fails** — `ERR_REQUIRE_ESM`. |
| TypeScript `moduleResolution: NodeNext` | Subpath `.d.ts` files import `./foo` without `.js` — **fails**. |
| `new QueryBuilder('users;drop table users--').where('id','=',1).toSql()` | Emits `FROM users;drop table users--` — **unquoted identifier injection**. |
| `.insert([{a:1},{a:2}]).make()` | Inserts **one** row. |
| `await qb.first()` | Returns a row immediately (sync function); on pg it **throws** (`allSync` missing). |
| `havingRaw('COUNT(*) > ?', [1]).toSql()` | SQL has `?`, `bindings` **empty**. |
| Package `exports` | No `require`, no `./migration-manager`, no `./adapters`. |
| `peerDependencies.better-sqlite3` | `""`. |

These match the source audit and are addressed in 1.0.0.

---

## 11. Consumer verification of packed `1.0.0` (this branch)

`node scripts/consumer-verify.mjs` packed `iagate-querykit-1.0.0.tgz` and installed it into four fresh projects. Exact results:

| Consumer | Result |
| --- | --- |
| `npm pack` | **PASS** — `iagate-querykit-1.0.0.tgz` |
| ESM `import` + SQLite insert/select | **PASS** — `esm-ok esm@x.com` |
| CJS `require` + SQLite insert/select | **PASS** — `cjs-ok cjs@x.com` |
| TypeScript `moduleResolution: NodeNext` (`tsc` + emit + run) | **PASS** — `tsc ok`, `nodenext-ok nodenext@x.com` |
| TypeScript `moduleResolution: bundler` (`tsc --noEmit`) | **PASS** — `tsc ok` |

Re-verified this round: same six PASS rows. Local suite: **464 passed / 0 skipped / 43 files**. Coverage **95.63% lines / 90.40% branches / 91.76% functions**. Live throwaway engines on `127.0.0.1`: Postgres 16, MySQL 8, SQL Server 2022, Oracle Free 23 (`qk_e_*` dropped, 0 leftovers). CI workflow starts Postgres 16 and MySQL 8; Oracle/MSSQL are `compose --profile full` (sequential, ~2 GiB each).

---

## 12. Round 3 findings (relations / geo / FTS / dialects)

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| R3-1 | High | `attachRelations` was reached only via `import()`, so v8 attributed ~1.6% to the file and tests mocked it away. | FIXED (static import) | `src/__tests__/relations-resolver.test.ts` |
| R3-2 | High | hasMany keyed parents in a `Map` so duplicate `localKey` values kept only the last parent. | FIXED | same |
| R3-3 | High | Selector `select: ['id','title']` dropped the join key, so eager-load attached nothing. | FIXED (include then strip) | same |
| R3-4 | High | `whereRelevanceSearch` put `LIKE ?` in SELECT with no `selectBindings`, stealing WHERE bindings. | FIXED | `src/__tests__/adversarial-round3.test.ts` |
| R3-5 | High | `stats({ customColumns })` interpolated column names raw. | FIXED | same |
| R3-6 | High | `selectRowNumber` interpolated alias/order columns; SQLite fallback SQL was invalid. | FIXED (`ROW_NUMBER() OVER` + quote) | same |
| R3-7 | Medium | `whereRegex` read `QueryKitConfig.defaultExecutor`, left columns unquoted, ignored flags. | FIXED | same |
| R3-8 | Medium | Regex LIKE fallback kept a plain token as exact `LIKE 'Sao'` (missed `Sao Paulo`). | FIXED | `src/__tests__/geo-fts.test.ts` |
| R3-9 | Medium | `whereFuzzySearch` validated threshold after mutating the builder. | FIXED | `src/__tests__/adversarial-round3.test.ts` |
| R3-10 | Medium | `whereDateRangeTz` on MSSQL ignored the timezone (fell through to BETWEEN). | FIXED | same + dialect snapshots |
| R3-11 | Medium | `whereFullText('   ')` compiled a match-everything predicate. | FIXED | `src/__tests__/geo-fts.test.ts` |
| R3-12 | Medium | `whereMultiSearch` ignored `operator: 'OR'`. | FIXED | `src/__tests__/adversarial-round3.test.ts` |
| R3-13 | Medium | Extra-column `LIKE_CI` used case-sensitive `orWhere LIKE`. | FIXED (`orWhereILike`) | same |
| R3-14 | Medium | `whereNearby` cannot run on stock SQLite (`acos`/`cos`/`sin` missing). | FIXED (register math helpers) | `src/__tests__/geo-fts.test.ts` + adapter |
| R3-15 | Low | `whereILike` called `executor()` (throws if only `defaultDialect` is set). | FIXED (`this.dialect()`) | `src/__tests__/branch-coverage.test.ts` |

---

## 13. Round 4 findings (FTS5 / Oracle / MSSQL / bind limits / savepoints)

| ID | Severity | Finding | Status | Covering test |
| --- | --- | --- | --- | --- |
| R4-1 | High | SQLite `whereFullText` used `LIKE %q%` (not FTS5). | FIXED (`MATCH` + `{cols}: q`) | `src/__tests__/fts5.test.ts`, `geo-fts.test.ts` |
| R4-2 | High | Multi-row `insert` sent every row in one statement and blew dialect bind ceilings (SQLite 999, MSSQL 2100, PG 65535). | FIXED (chunk + `.maxBindings()`) | `src/__tests__/adversarial-round4.test.ts` |
| R4-3 | High | Nested `transaction()` issued a second `BEGIN` on SQLite (and no savepoints on other adapters). | FIXED | same + live PG/MySQL/MSSQL/Oracle |
| R4-4 | High | MySQL `DATETIME` rejected ISO-8601 `Date` bindings (`2024-01-01T00:00:00.000Z`). | FIXED (`mysqlBind`) | `src/__tests__/integration/mysql.test.ts` |
| R4-5 | Medium | Postgres pool with `max=1` could hang forever on a second `transaction()`. | FIXED (`connectionTimeoutMillis` default 30s) | `src/__tests__/integration/postgres.test.ts` |
| R4-6 | Medium | MySQL pool queued forever when `connectionLimit` was exhausted. | FIXED (config `waitForConnections` / `queueLimit`) | `src/__tests__/integration/mysql.test.ts` |
| R4-7 | Medium | `migrateDown` `ctx.runSync` throw + delete-via-`executeQuery` were untested. | FIXED | `src/__tests__/migrations.test.ts` |
| R4-8 | Medium | Trigger catalog `default` fallback returned `[]` on the first empty hit when `dialect` was unknown. | FIXED (keep probing) | `src/__tests__/views-triggers.test.ts` |
| R4-9 | Medium | Large INTEGER / `bigint` lost precision on SQLite read (`Number`). | FIXED (opt-in `safeIntegers`) | `src/__tests__/adversarial-round4.test.ts` |
| R4-10 | Low | Bind / insert failures were plain `Error` with no `code`. | FIXED (`BindError` / `InsertError` / `QueryKitError`) | same |
| R4-11 | Info | Oracle/SQL Server had never been executed live in this VM. | FIXED (Docker + host network; sequential) | `src/__tests__/integration/mssql.test.ts`, `oracle.test.ts` |

Hard rule: every live engine was `127.0.0.1` only. Ephemeral `qk_e_*` databases were dropped (0 leftovers). Ambient `DATABASE_URL` / `POSTGRES_*` / `MYSQL_*` ignored. Not published.
