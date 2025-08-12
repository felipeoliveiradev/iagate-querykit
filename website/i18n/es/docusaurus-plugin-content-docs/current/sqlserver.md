---
id: sqlserver
title: SQL Server
---

Visión general

- Ejecutor: `SqlServerExecutor` (driver `mssql`/`tedious`).
- Asíncrono; funciona con `QueryBuilder.make()`.
- Convierte `?` a `@p1, @p2, ...` automáticamente.

Instalación
```bash
npm install mssql
```

Configuración
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

Lecturas (SELECT)
```ts
const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .orderBy('id', 'DESC')
  .all()
```

Escrituras (INSERT/UPDATE/DELETE)
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Placeholders

- `?` → `@p1, @p2, ...` por el adapter.

Transacciones

Se recomienda habilitar `SET XACT_ABORT ON` para asegurar rollback en error.

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

En error → rollback total:
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

- `pool.max/min`: tamaño del pool de conexiones.
- `options.trustServerCertificate`: útil en entornos de desarrollo. 