# Changelog

## 1.0.0

Production hardening of `iagate-querykit`. This is a **breaking** release.

### Breaking

- Identifiers (tables, columns, aliases, views, triggers, indexes) are quoted per dialect and rejected if they are not safe (`[A-Za-z_][A-Za-z0-9_]*`, dotted paths allowed). Hostile names such as `users;drop table users--` now throw `UnsafeIdentifierError` instead of being interpolated into SQL.
- `QueryBuilder.get()`, `.first()`, and `.find()` are **async** and no longer call `allSync()`. Use `.getSync()` / `.firstSync()` for the synchronous SQLite path. They no longer mutate the original builder (`limit(1)` / `where id`).
- Generated SQL uses quoted identifiers. Snapshots or string assertions of unquoted SQL will fail.
- `DatabaseExecutor.dialect` is required. First-party adapters set it (`sqlite` | `mysql` | `postgres` | `mssql` | `oracle`).
- Adapter `executeQuery` always returns a `QueryResult` (`{ data, affectedRows?, lastInsertId? }`). MySQL no longer returns a raw `[rows, info]` tuple.
- `LIMIT`/`OFFSET` on MSSQL and Oracle compile to `OFFSET n ROWS FETCH NEXT n ROWS ONLY`.
- `MultiDatabaseManager.getInstance()` throws if called with no config before initialization. Use `resetInstance()` in tests.
- `DatabaseType` no longer advertises unimplemented engines (MongoDB, Redis, Hadoop, …).
- Package is dual ESM/CJS. Subpath exports include `require` conditions. Relative imports in published JS use explicit extensions.
- `peerDependencies.better-sqlite3` is a real semver range. Optional peers added for `pg`, `mysql2`, `oracledb`, `mssql`.
- `repository.directory` (`packages/querykit`) was removed; this repository is the package root.
- `count()` default alias is `count` (was `count_*`).
- `whereIf` is truthy (`whereIf(false, …)` no longer applies). `whereAll` applies every defined value, including `false` and `0`.
- `Model.delete()` throws when the instance has no `id`.
- Trigger DDL is dialect-specific. `CREATE TRIGGER IF NOT EXISTS … BEGIN … END` is SQLite-only.

### Security and correctness

- Placeholder conversion (`?` → `$1` / `:1` / `@p1`) skips string literals and comments.
- `havingRaw` and `whereJsonContains` bind their parameters.
- Multi-row `insert([...])` inserts every row.
- `toSql()` no longer mutates `selectColumns` when aggregates are present.
- `exists()` compiles `SELECT 1` on a clone instead of appending to the current select list.
- `updateOrInsert` and seed truncate+insert run inside `transaction()` when the executor provides one.
- SQLite enables `PRAGMA foreign_keys = ON`.
- SELECT detection understands CTEs, leading comments, `PRAGMA`, `EXPLAIN`, and `VALUES`.

### Features

- `transaction(fn)` and `close()` on every first-party executor.
- `BetterSqlite3Executor` accepts a file path or an existing `better-sqlite3` Database.
- Postgres inserts use `RETURNING *` so `lastInsertId` is populated.
- `setRelations()` registers eager-load graphs (replaces the undocumented `QK_RELATIONS_PATH`-only path).
- `where(column, value)` is accepted as equality (docs used this form).
- `scheduler.list()` / `scheduler.clear()`; intervals are `unref()`'d.
- `resetQueryKitConfig()` for tests.
- Dual package exports for previously missing entry points: `./adapters`, `./migration-manager`, `./migration-dsl`, `./seed`, `./relations-resolver`.
- GitHub Actions CI (typecheck/test/build) and provenance publish on GitHub Release and push to `main`.

### Docs

- README API catalog, packaging, and release notes aligned with the implementation.
- `RELEASE.md` documents `NPM_TOKEN` and the publish workflow.
- MIT `LICENSE` is included in the published tarball.

### Structural (same 1.0.0, unpublished)

- SQL compilation lives in `src/sql/compile.ts` (`compileSelect` / `compileWhere`). `QueryBuilder.toSql()` is a thin snapshot + compile call.
- `createQueryKit(executor)` is the preferred entry: bound `table()` / `transaction()` / `close()` without the global `QueryKitConfig`.
- `QueryBuilder` accepts `{ executor }` and `.use(executor)`.
- Adapters share `loadOptionalPeer` / `asWrite` in `src/adapters/shared.ts`.
- `selectAllExcept` no longer hijacks `pendingAction`; SQLite expands columns via `PRAGMA table_info`.
- Fuzzy-search score placeholders are real bindings (`selectBindings`), not a leftover `pendingAction`.
- `pluck` / `pluckSync` clone first; `scalar()` is async; `run()` refuses pending writes.
- `BaseDatabaseAdapter.backup/restore/getConnectionInfo` throw instead of silently succeeding.
- See `STUDY.md` for architecture, coverage (95.73% lines / 90.14% branches), and measured benchmarks.

### Adversarial hardening (same 1.0.0, unpublished)

- `where(col, null)` compiles to `IS NULL`; `undefined` bindings are rejected.
- `whereNotIn` / `orWhereNotIn` require an array (non-array no longer compiles to `1=1`).
- `orWhereIn` / `orWhereNotIn` go through `orWhereClauses` so AND/OR groups are parenthesized.
- `Model.save()` treats `id === 0` as an existing row (UPDATE, not INSERT).
- `increment` / `decrement` reject `NaN` / non-finite amounts.
- `select([])` throws; `orderBy` requires a column and only `ASC`/`DESC`.
- SQLite/MySQL `OFFSET` without `LIMIT` emits a dummy unlimited `LIMIT` so the SQL is valid.
- `all` / `allSync` / `exists` throw if a write is pending (no more silent `insert().all()`).
- `exists()` clears leftover aggregates on the clone.
- `limit` / `offset` require non-negative integers.
- Bindings: Date → ISO, plain / null-prototype objects → JSON; custom class instances, functions, and symbols are rejected.
- `whereJsonContains` on SQLite uses `json_extract` / `json_each` (not `LIKE` substring). Oracle/MSSQL no longer ignore the search value.
- `whereFindInSet` / `whereArrayContains` quote identifiers and match CSV tokens (not substrings).
- `whereIf` accepts the 2-arg equality form; `whereBetween` / `having` reject bad tuples / `undefined`.
- Unicode identifiers (`\p{L}\p{N}`) are allowed when quoted.
- Live Postgres 16 + MySQL 8 integration tests run only against throwaway loopback databases (CI service containers / `docker-compose.test.yml` / local test cluster). Each suite `CREATE DATABASE qk_e_*` and `DROP`s it after. Ambient `POSTGRES_*` / `MYSQL_*` / `DATABASE_URL` are ignored. Non-loopback hosts are refused.
- Property tests (`fast-check`) and every README/docs example run as Vitest cases.

### Relations, geo/FTS, dialects (same 1.0.0, unpublished)

- `attachRelations` is a static import (no `QK_RELATIONS_PATH` / dynamic `import()`). Eager-load batches with `whereIn`, honors `localKey`/`ownerKey`, nested graphs (depth 4, cycle guard), and selector `select` lists (join keys are kept for the join then stripped).
- `whereFullText` / `whereNearby` / `whereRegex` / `whereDateRangeTz` quote identifiers and pick SQL from the bound executor. Live round-trips on throwaway SQLite, Postgres, and MySQL. Oracle and SQL Server are SQL-snapshot + adapter-mock tested (no Docker in this environment).
- `whereRelevanceSearch` binds score placeholders. `whereFuzzySearch` validates threshold before mutating. `stats({ customColumns })` and `selectRowNumber` quote identifiers. `whereMultiSearch` honors `OR` and case-insensitive extra columns.
- SQLite registers `acos`/`cos`/`sin`/`radians` so Haversine `whereNearby` executes.
- Coverage: **95.73% lines / 90.14% branches / 91.06% functions** (427 tests). Packed tarball re-verified in ESM, CJS, TS NodeNext, and TS bundler consumers.

### Round 4 — FTS5, live Oracle/MSSQL, bind limits, savepoints (same 1.0.0, unpublished)

- SQLite `whereFullText` uses FTS5 `MATCH` with `{col}: query` column filters. Helpers: `fts5CreateSql` / `createFts5VirtualTable` / `fts5RebuildSql` / `fts5ContentSyncTriggersSql`.
- Multi-row `insert([...])` chunks at the dialect bind ceiling (SQLite 999 / 32766 via `.maxBindings()`, MSSQL 2100, Postgres/MySQL/Oracle 65535).
- Nested `transaction()` uses `SAVEPOINT` (SQLite/PG/MySQL), `SAVE TRANSACTION` (MSSQL), `SAVEPOINT` without RELEASE (Oracle). Inner rollback keeps outer work.
- Typed errors: `QueryKitError`, `BindError`, `InsertError`, `UnsafeIdentifierError` (`code`).
- MySQL adapter rewrites ISO-8601 UTC Date strings so `DATETIME` accepts them.
- Postgres/MySQL pools expose `connectionTimeoutMillis` / `waitForConnections` so exhaustion fails instead of hanging.
- Live throwaway SQL Server 2022 and Oracle Free 23 ran in this VM (`docker` + `--network host`). Both cannot share the 4 GiB leftover RAM; tests run sequentially.
- `expectTypeOf` contracts for `QueryBuilder`, `createQueryKit`, adapters, and helpers.
- Coverage: **95.63% lines / 90.40% branches / 91.76% functions** (464 tests). Packed tarball re-verified.
