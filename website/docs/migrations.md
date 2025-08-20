---
id: migrations
title: Migrações
---

As migrações permitem versionar o schema e dados do banco de forma organizada e semântica.

## Conceitos

- **Tabela de controle**: `querykit_migrations` (criada automaticamente por dialeto)
- **Versão atual**: lista ordenada dos `id`s presentes nessa tabela
- **Migração**: objeto com `id` único e passos `up` (aplicar) e opcionalmente `down` (reverter)
- **Dialetos suportados**: sqlite (padrão), mysql, postgres, mssql, oracle

## APIs

```ts
import { migrateUp, migrateDown, listAppliedMigrations, resetMigrations } from 'iagate-querykit';
```

- `migrateUp(migrations, { to?, executor? })`: aplica em ordem; para em `to` se fornecido
- `migrateDown(migrations, { to?, steps?, executor? })`: reverte do mais recente para o mais antigo; para em `to` ou após `steps`
- `listAppliedMigrations({ executor? })`: lista `id`s aplicados por ordem de aplicação
- `resetMigrations({ executor? })`: descarta a tabela de controle (perigoso em produção)

## Tipos

```ts
export type MigrationSpec = {
  id: string
  up: string | string[] | ((ctx) => Promise<void> | void)
  down?: string | string[] | ((ctx) => Promise<void> | void)
  tags?: string[]
}
```

`ctx` expõe:
- `exec`: executor atual
- `dialect`: dialeto atual
- `query(sql, bindings?)`: executa SQL assíncrono
- `runSync(sql, bindings?)`: executa SQL síncrono (se suportado)
- `qb<T>(table)`: helper para `QueryBuilder`

## Mapeamentos

### ColumnType → tipo por dialeto

- sqlite | mysql | postgres | mssql | oracle

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

- Suportado: valores primitivos (`number`, `string`, `boolean`), `null`, `ColumnDefault.CurrentTimestamp` e `ColumnDefault.UuidV4`

| Default | sqlite | mysql | postgres | mssql | oracle |
| --- | --- | --- | --- | --- | --- |
| null | NULL | NULL | NULL | NULL | NULL |
| true/false | 1 / 0 | 1 / 0 | TRUE / FALSE | 1 / 0 | 1 / 0 |
| string `'x'` | `'x'` (com escaping) | `'x'` | `'x'` | `'x'` | `'x'` |
| number `123` | 123 | 123 | 123 | 123 | 123 |
| CurrentTimestamp | CURRENT_TIMESTAMP | CURRENT_TIMESTAMP | CURRENT_TIMESTAMP | GETDATE() | CURRENT_TIMESTAMP |
| UuidV4 | expressão com randomblob/hex | UUID() | gen_random_uuid() | NEWID() | LOWER(RAWTOHEX(SYS_GUID())) |

## DSL Semântica

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
- sqlite: exige `INTEGER PRIMARY KEY AUTOINCREMENT` na coluna
- mysql: `AUTO_INCREMENT`
- postgres: `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY` (ou `mode: 'serial'` para `SERIAL`/`BIGSERIAL`)
- mssql: `IDENTITY(seed, step)`
- oracle: `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY`

## Tabela de opções (createTable)

| Propriedade | Tipo | Obrigatório | Exemplo | Observações |
| --- | --- | --- | --- | --- |
| `type` | `ColumnType` | sim | `ColumnType.Int` | Define o tipo lógico; mapeado por dialeto (ver tabela acima) |
| `primaryKey` | `boolean` | não | `true` | Em sqlite, com `autoIncrement` vira `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `notNull` | `boolean` | não | `true` | Gera `NOT NULL` |
| `unique` | `boolean` | não | `true` | Gera `UNIQUE` |
| `default` | `string \| number \| boolean \| null \| ColumnDefault` | não | `ColumnDefault.CurrentTimestamp` | Ver mapeamentos de `ColumnDefault` |
| `length` | `number` | não | `255` | Para `String`/`Varchar` |
| `precision` | `number` | não | `12` | Para `Decimal` |
| `scale` | `number` | não | `2` | Para `Decimal` |
| `autoIncrement` | `boolean \| { mode?: 'always' \| 'default' \| 'serial'; start?: number; increment?: number }` | não | `true`, `{ mode: 'serial' }` | MySQL `AUTO_INCREMENT`; Postgres Identity/Serial; MSSQL `IDENTITY(s,i)`; Oracle Identity; SQLite requer `INTEGER PRIMARY KEY` |

## Exemplos de uso

### 1) Mínimo viável

```ts
const migrations = [
  { id: '001_init', up: 'CREATE TABLE t(id INT)' },
]
await migrateUp(migrations)
```

### 2) Arrays de SQL e reversão

```ts
const migrations = [
  { id: '001_init', up: [
      'CREATE TABLE t(id INT, name TEXT)',
      'CREATE INDEX IF NOT EXISTS t_name_idx ON t(name)'
    ],
    down: 'DROP TABLE t' },
]
await migrateUp(migrations)
await migrateDown(migrations) // reverte 001_init
```

### 3) `to` e `steps`

```ts
await migrateUp(migrations, { to: '002_add_columns' }) // aplica até 002
await migrateDown(migrations, { steps: 2 }) // reverte 2 últimas
```

### 4) Callbacks assíncronos com `ctx`

```ts
const migrations = [
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

### 5) DSL completa com vários tipos

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

## Multi‑dialeto: diferenças importantes

- `Boolean`: sqlite → `INTEGER`; mysql → `TINYINT(1)`; postgres → `BOOLEAN`; mssql → `BIT`; oracle → `NUMBER(1)`
- `Json`: postgres → `JSONB`; mysql → `JSON`; sqlite/oracle/mssql → tipos textuais/LOB
- `TimestampTz`: postgres → `TIMESTAMPTZ`; mssql → `DATETIMEOFFSET`; oracle → `TIMESTAMP WITH TIME ZONE`
- `DateTime`: postgres → `TIMESTAMP`; mysql → `DATETIME`; mssql → `DATETIME2`

## Boas práticas

- Use `id` ordenável (timestamp ISO ou contador zero‑padded) para garantir ordem determinística
- Sempre forneça `down` quando possível
- Agrupe mudanças relacionadas em uma única migração
- Teste em ambiente de homologação antes de produção

## Solução de problemas

- "Tabela `querykit_migrations` não existe": a criação é automática; verifique permissões do usuário
- Erros de tipo por dialeto: confira mapeamentos de `ColumnType` nesta página
- "runSync não suportado": use apenas `ctx.query` se seu executor não oferecer API síncrona

## Referência rápida da DSL

- `createTable(name, columns)`
- `dropTable(name)`
- `addColumn(table, column, def)`
- `dropColumn(table, column)`
- `renameColumn(table, from, to)`
- `createIndex(table, columns, { unique?, name? })`
- `dropIndex(name)`
- `raw(sql)` 