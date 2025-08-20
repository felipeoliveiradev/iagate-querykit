---
id: migrations
title: Migrations
---

Migrations let you version schema and data changes in an organized, semantic way.

## Concepts

- **Control table**: `querykit_migrations` (auto-created per dialect)
- **Current version**: ordered list of `id`s in that table
- **Migration**: object with unique `id`, `up` (apply) and optional `down` (revert)
- **Supported dialects**: sqlite (default), mysql, postgres, mssql, oracle

## APIs

```ts
import { migrateUp, migrateDown, listAppliedMigrations, resetMigrations } from 'iagate-querykit';
```

- `migrateUp(migrations, { to?, executor? })`: applies in order; stops at `to` if provided
- `migrateDown(migrations, { to?, steps?, executor? })`: reverts from newest to oldest; stops at `to` or after `steps`
- `listAppliedMigrations({ executor? })`: returns ordered `id`s
- `resetMigrations({ executor? })`: drops control table (dangerous in production)

## Types

```ts
export type MigrationSpec = {
  id: string
  up: string | string[] | ((ctx) => Promise<void> | void)
  down?: string | string[] | ((ctx) => Promise<void> | void)
  tags?: string[]
}
```

`ctx` provides:
- `exec`: current executor
- `dialect`: current dialect
- `query(sql, bindings?)`: async SQL execution
- `runSync(sql, bindings?)`: sync SQL (if supported)
- `qb<T>(table)`: `QueryBuilder` helper

## Mappings

### ColumnType → type per dialect

| ColumnType | sqlite | mysql | postgres | mssql | oracle |
| --- | --- | --- | --- | --- | --- |
| Int | INTEGER | INT | INTEGER | INT | NUMBER |
| BigInt | BIGINT | BIGINT | BIGINT | BIGINT | NUMBER(19) |
| Float | REAL | FLOAT | REAL | FLOAT | BINARY_FLOAT |
| Double | DOUBLE | DOUBLE | DOUBLE PRECISION | FLOAT(53) | BINARY_DOUBLE |
| Decimal(p,s) | NUMERIC(p,s) | DECIMAL(p,s) | DECIMAL(p,s) | DECIMAL(p,s) | NUMBER(p,s) |
| String(len) | VARCHAR(len) | VARCHAR(len) | VARCHAR(len) | NVARCHAR(len) | VARCHAR2(len) |
| Varchar(len) | VARCHAR(len) | VARCHAR(len) | VARCHAR(len) | NVARCHAR(len) | VARCHAR2(len) |
| Text | TEXT | TEXT | TEXT | NVARCHAR(MAX) | CLOB |
| Date | DATE | DATE | DATE | DATE | DATE |
| Time | TEXT | TIME | TIME | TIME | VARCHAR2(20) |
| DateTime | DATETIME | DATETIME | TIMESTAMP | DATETIME2 | TIMESTAMP |
| Timestamp | DATETIME | DATETIME | TIMESTAMP | DATETIME2 | TIMESTAMP |
| TimestampTz | DATETIME | TIMESTAMPTZ | TIMESTAMPTZ | DATETIMEOFFSET | TIMESTAMP WITH TIME ZONE |
| Boolean | INTEGER | TINYINT(1) | BOOLEAN | BIT | NUMBER(1) |
| Json | TEXT | JSON | JSONB | NVARCHAR(MAX) | CLOB |
| Uuid | CHAR(36) | CHAR(36) | UUID | UNIQUEIDENTIFIER | VARCHAR2(36) |
| Binary | BLOB | BLOB | BYTEA | VARBINARY(MAX) | BLOB |

### ColumnDefault

Supported: primitive values (`number`, `string`, `boolean`), `null`, `ColumnDefault.CurrentTimestamp`, and `ColumnDefault.UuidV4`.

| Default | sqlite | mysql | postgres | mssql | oracle |
| --- | --- | --- | --- | --- | --- |
| null | NULL | NULL | NULL | NULL | NULL |
| true/false | 1 / 0 | 1 / 0 | TRUE / FALSE | 1 / 0 | 1 / 0 |
| string `'x'` | `'x'` (escaped) | `'x'` | `'x'` | `'x'` | `'x'` |
| number `123` | 123 | 123 | 123 | 123 | 123 |
| CurrentTimestamp | CURRENT_TIMESTAMP | CURRENT_TIMESTAMP | CURRENT_TIMESTAMP | GETDATE() | CURRENT_TIMESTAMP |
| UuidV4 | randomblob/hex expression | UUID() | gen_random_uuid() | NEWID() | LOWER(RAWTOHEX(SYS_GUID())) |

## Semantic DSL

```ts
import { migration, MigrationBuilder, ColumnType, ColumnDefault } from 'iagate-querykit';

const up = migration((b: MigrationBuilder) => {
  b.createTable('users', {
    id: { type: ColumnType.Int, primaryKey: true, autoIncrement: true },
    uuid: { type: ColumnType.Uuid, default: ColumnDefault.UuidV4 },
    email: { type: ColumnType.Varchar, length: 120, notNull: true, unique: true },
    active: { type: ColumnType.Boolean, default: 1 },
    created_at: { type: ColumnType.TimestampTz, default: ColumnDefault.CurrentTimestamp, notNull: true },
  })
})
```

Notes on `autoIncrement`:
- sqlite: `INTEGER PRIMARY KEY AUTOINCREMENT`
- mysql: `AUTO_INCREMENT`
- postgres: `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY` (or `mode: 'serial'` for `SERIAL`/`BIGSERIAL`)
- mssql: `IDENTITY(seed, step)`
- oracle: `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY`

## Options table (createTable)

| Property | Type | Required | Example | Notes |
| --- | --- | --- | --- | --- |
| `type` | `ColumnType` | yes | `ColumnType.Int` | Logical type; dialect-mapped (see above) |
| `primaryKey` | `boolean` | no | `true` | In sqlite, with `autoIncrement` becomes `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `notNull` | `boolean` | no | `true` | Emits `NOT NULL` |
| `unique` | `boolean` | no | `true` | Emits `UNIQUE` |
| `default` | `string \| number \| boolean \| null \| ColumnDefault` | no | `ColumnDefault.CurrentTimestamp` | See ColumnDefault mappings |
| `length` | `number` | no | `255` | For `String`/`Varchar` |
| `precision` | `number` | no | `12` | For `Decimal` |
| `scale` | `number` | no | `2` | For `Decimal` |
| `autoIncrement` | `boolean \| { mode?: 'always' \| 'default' \| 'serial'; start?: number; increment?: number }` | no | `true`, `{ mode: 'serial' }` | MySQL `AUTO_INCREMENT`; Postgres Identity/Serial; MSSQL `IDENTITY(s,i)`; Oracle Identity; SQLite requires `INTEGER PRIMARY KEY` |

## Usage examples

### 1) Minimal

```
```