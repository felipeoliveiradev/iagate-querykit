---
id: migrations
title: Migraciones
---

Las migraciones permiten versionar cambios de esquema y datos de manera organizada y semántica.

## Conceptos

- **Tabla de control**: `querykit_migrations` (creada automáticamente por dialecto)
- **Versión actual**: lista ordenada de `id`s en esa tabla
- **Migración**: objeto con `id` único, `up` (aplicar) y opcional `down` (revertir)
- **Dialectos soportados**: sqlite (por defecto), mysql, postgres, mssql, oracle

## APIs

```ts
import { migrateUp, migrateDown, listAppliedMigrations, resetMigrations } from 'iagate-querykit';
```

- `migrateUp(migraciones, { to?, executor? })`: aplica en orden; se detiene en `to` si se proporciona
- `migrateDown(migraciones, { to?, steps?, executor? })`: revierte de la más reciente a la más antigua; se detiene en `to` o después de `steps`
- `listAppliedMigrations({ executor? })`: devuelve `id`s en orden
- `resetMigrations({ executor? })`: elimina la tabla de control (peligroso en producción)

## Tipos

```ts
export type MigrationSpec = {
  id: string
  up: string | string[] | ((ctx) => Promise<void> | void)
  down?: string | string[] | ((ctx) => Promise<void> | void)
  tags?: string[]
}
```

`ctx` provee:
- `exec`: ejecutor actual
- `dialect`: dialecto actual
- `query(sql, bindings?)`: ejecución SQL asíncrona
- `runSync(sql, bindings?)`: SQL síncrono (si está soportado)
- `qb<T>(table)`: helper de `QueryBuilder`

## Mapeos

### ColumnType → tipo por dialecto

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

Soportado: valores primitivos (`number`, `string`, `boolean`), `null`, `ColumnDefault.CurrentTimestamp` y `ColumnDefault.UuidV4`.

| Default | sqlite | mysql | postgres | mssql | oracle |
| --- | --- | --- | --- | --- | --- |
| null | NULL | NULL | NULL | NULL | NULL |
| true/false | 1 / 0 | 1 / 0 | TRUE / FALSE | 1 / 0 | 1 / 0 |
| string `'x'` | `'x'` (con escape) | `'x'` | `'x'` | `'x'` | `'x'` |
| number `123` | 123 | 123 | 123 | 123 | 123 |
| CurrentTimestamp | CURRENT_TIMESTAMP | CURRENT_TIMESTAMP | CURRENT_TIMESTAMP | GETDATE() | CURRENT_TIMESTAMP |
| UuidV4 | expresión randomblob/hex | UUID() | gen_random_uuid() | NEWID() | LOWER(RAWTOHEX(SYS_GUID())) |

## DSL Semántica

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

Notas sobre `autoIncrement`:
- sqlite: `INTEGER PRIMARY KEY AUTOINCREMENT`
- mysql: `AUTO_INCREMENT`
- postgres: `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY` (o `mode: 'serial'` para `SERIAL`/`BIGSERIAL`)
- mssql: `IDENTITY(seed, step)`
- oracle: `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY`

## Tabla de opciones (createTable)

| Propiedad | Tipo | Requerido | Ejemplo | Notas |
| --- | --- | --- | --- | --- |
| `type` | `ColumnType` | sí | `ColumnType.Int` | Tipo lógico; mapeado por dialecto (ver arriba) |
| `primaryKey` | `boolean` | no | `true` | En sqlite, con `autoIncrement` se vuelve `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `notNull` | `boolean` | no | `true` | Genera `NOT NULL` |
| `unique` | `boolean` | no | `true` | Genera `UNIQUE` |
| `default` | `string | number | boolean | null | ColumnDefault` | no | `ColumnDefault.CurrentTimestamp` | Ver mapeos de `ColumnDefault` |
| `length` | `number` | no | `255` | Para `String`/`Varchar` |
| `precision` | `number` | no | `12` | Para `Decimal` |
| `scale` | `number` | no | `2` | Para `Decimal` |
| `autoIncrement` | `boolean | { mode?: 'always' | 'default' | 'serial'; start?: number; increment?: number }` | no | `true`, `{ mode: 'serial' }` | MySQL `AUTO_INCREMENT`; Postgres Identity/Serial; MSSQL `IDENTITY(s,i)`; Oracle Identity; SQLite requiere `INTEGER PRIMARY KEY` |

## Ejemplos de uso

### 1) Mínimo

```ts
const migraciones = [
  { id: '001_init', up: 'CREATE TABLE t(id INT)' },
]
await migrateUp(migraciones)
```

### 2) Arreglos de SQL y `down`

```ts
const migraciones = [
  { id: '001_init', up: [
      'CREATE TABLE t(id INT, name TEXT)',
      'CREATE INDEX IF NOT EXISTS t_name_idx ON t(name)'
    ],
    down: 'DROP TABLE t' },
]
await migrateUp(migraciones)
await migrateDown(migraciones) // revierte 001_init
```

### 3) `to` y `steps`

```ts
await migrateUp(migraciones, { to: '002_add_columns' })
await migrateDown(migraciones, { steps: 2 })
```

### 4) Callbacks asíncronos con `ctx`

```ts
const migraciones = [
  { id: '003_complex', up: async (ctx) => {
      await ctx.query('CREATE TABLE a(id INT)')
      await ctx.query('CREATE TABLE b(id INT)')
      const q = ctx.qb('a').insert({ id: 1 })
      const { sql, bindings } = q.toSql()
      await ctx.query(sql, bindings)
    },
    down: async (ctx) => {
      await ctx.query('DROP TABLE b')
      await ctx.query('DROP TABLE a')
    }
  }
]
```

### 5) DSL completa con varios tipos

```ts
const up = migration(b => {
  b.createTable('orders', {
    id: { type: ColumnType.BigInt, primaryKey: true },
    user_id: { type: ColumnType.Uuid, notNull: true },
    total: { type: ColumnType.Decimal, precision: 12, scale: 2, notNull: true },
    placed_at: { type: ColumnType.DateTime, default: ColumnDefault.CurrentTimestamp },
    paid: { type: ColumnType.Boolean, default: 0 },
    payload: { type: ColumnType.Json },
  })
   .createIndex('orders', ['user_id'])
})
```

## Notas multi‑dialecto

- `Boolean`: sqlite → `INTEGER`; mysql → `TINYINT(1)`; postgres → `BOOLEAN`; mssql → `BIT`; oracle → `NUMBER(1)`
- `Json`: postgres → `JSONB`; mysql → `JSON`; sqlite/oracle/mssql → tipos de texto/LOB
- `TimestampTz`: postgres → `TIMESTAMPTZ`; mssql → `