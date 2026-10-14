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
