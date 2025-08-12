---
id: oracle
title: Oracle
---

Visión general

- Ejecutor: `OracleExecutor` (driver `oracledb`).
- Asíncrono; funciona con `QueryBuilder.make()`.
- Convierte `?` a `:1, :2, ...` automáticamente.

Instalación
```bash
npm install oracledb
```

Configuración
```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { OracleExecutor } from 'iagate-querykit/adapters/oracle'

setDefaultExecutor(new OracleExecutor({
  user: 'scott',
  password: 'tiger',
  connectString: 'localhost/XEPDB1',
  poolMin: 0,
  poolMax: 10,
}))
```

Lecturas (SELECT)
```ts
const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .all()
```

Escrituras (INSERT/UPDATE/DELETE)
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Placeholders

- El adapter convierte `?` en `:1, :2, ...` automáticamente.

Transacciones

Nota: el adapter usa `autoCommit: true`. Para transacciones multi‑sentencia, controla con sentencias explícitas.

Básico:
```ts
import { QueryKitConfig } from 'iagate-querykit'
const exec = QueryKitConfig.defaultExecutor!

await exec.executeQuery('BEGIN', [])
await exec.executeQuery('INSERT INTO users (email) VALUES (?)', ['x@y.com'])
await exec.executeQuery('COMMIT', [])
```

SAVEPOINT/ROLLBACK:
```ts
await exec.executeQuery('BEGIN', [])
await exec.executeQuery('SAVEPOINT sp1', [])
await exec.executeQuery('UPDATE users SET active = ? WHERE id = ?', [0, 1])
await exec.executeQuery('ROLLBACK TO SAVEPOINT sp1', [])
await exec.executeQuery('COMMIT', [])
```

En error → rollback:
```ts
await exec.executeQuery('BEGIN', [])
try {
  await exec.executeQuery('INSERT INTO logs (payload) VALUES (?)', ['ok'])
  await exec.executeQuery('COMMIT', [])
} catch {
  await exec.executeQuery('ROLLBACK', [])
}
```

Dependencias nativas

- `oracledb` requiere librerías nativas (Oracle Instant Client) instaladas en el sistema. 