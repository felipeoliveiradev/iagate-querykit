---
id: sqlserver
title: SQL Server
---

Visão geral

- Executor: `SqlServerExecutor` (driver `mssql`/`tedious`).
- Assíncrono; compatível com `QueryBuilder.make()`.
- Converte `?` para `@p1, @p2, ...` automaticamente.

Instalação
```bash
npm install mssql
```

Configuração
```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { SqlServerExecutor } from 'iagate-querykit/adapters/sqlserver'

setDefaultExecutor(new SqlServerExecutor({
  user: 'sa',
  password: 'Passw0rd!',
  server: 'localhost',
  database: 'app',
  pool: { max: 10, min: 0 },
  options: { trustServerCertificate: true },
}))
```

Leituras (SELECT)
```ts
const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .orderBy('id', 'DESC')
  .all()
```

Escritas (INSERT/UPDATE/DELETE)
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Placeholders

- `?` → `@p1, @p2, ...` pelo adapter.

Transações

Recomendado habilitar `SET XACT_ABORT ON` para garantir rollback em erro.

Básico:
```ts
import { QueryKitConfig } from 'iagate-querykit'
const exec = QueryKitConfig.defaultExecutor!

await exec.executeQuery('SET XACT_ABORT ON', [])
await exec.executeQuery('BEGIN TRAN', [])
await exec.executeQuery('INSERT INTO users (email) VALUES (?)', ['x@y.com'])
await exec.executeQuery('COMMIT', [])
```

SAVEPOINT/ROLLBACK:
```ts
await exec.executeQuery('BEGIN TRAN', [])
await exec.executeQuery('SAVE TRAN sp1', [])
await exec.executeQuery('UPDATE users SET active = ? WHERE id = ?', [0, 1])
await exec.executeQuery('ROLLBACK TRAN sp1', [])
await exec.executeQuery('COMMIT', [])
```

Erro → rollback total:
```ts
await exec.executeQuery('BEGIN TRAN', [])
try {
  await exec.executeQuery('DELETE FROM sessions WHERE user_id = ?', [1])
  await exec.executeQuery('COMMIT', [])
} catch {
  await exec.executeQuery('ROLLBACK', [])
}
```

Pool

- `pool.max/min`: tamaho do pool de conexões.
- `options.trustServerCertificate`: útil em ambientes de dev. 