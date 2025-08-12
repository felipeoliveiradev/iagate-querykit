---
id: postgresql
title: PostgreSQL
---

Visión general

- Ejecutor: `PostgresExecutor` (driver `pg`).
- Asíncrono; funciona con `QueryBuilder.make()`.
- Convierte `?` a `$1, $2, ...` automáticamente.

Instalación
```bash
npm install pg
```

Configuración
```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { PostgresExecutor } from 'iagate-querykit/adapters/postgresql'

setDefaultExecutor(new PostgresExecutor({
  connectionString: 'postgres://user:pass@localhost:5432/app',
  poolSize: 10,
}))
```

Lecturas (SELECT)
```ts
const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .orderBy('id', 'DESC')
  .limit(10)
  .all()
```

Escrituras (INSERT/UPDATE/DELETE)
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Placeholders

- El builder usa `?`; el adapter convierte a `$1, $2, ...`.

Transacciones

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
await exec.executeQuery('ROLLBACK TO sp1', [])
await exec.executeQuery('COMMIT', [])
```

Error → rollback total:
```ts
await exec.executeQuery('BEGIN', [])
try {
  await exec.executeQuery('INSERT INTO payments (user_id, amount) VALUES (?, ?)', [1, 10])
  await exec.executeQuery('COMMIT', [])
} catch {
  await exec.executeQuery('ROLLBACK', [])
}
```

Pool

- `poolSize`: máximo de conexiones (predeterminado 10). Ajusta según la carga.

Solución de problemas

- Errores de autenticación: verifica credenciales.
- SSL: proporciona `ssl` si es requerido. 