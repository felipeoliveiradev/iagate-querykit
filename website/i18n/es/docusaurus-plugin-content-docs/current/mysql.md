---
id: mysql
title: MySQL
---

Visión general

- Ejecutor: `MysqlExecutor` (driver `mysql2/promise`).
- Totalmente asíncrono; funciona con `QueryBuilder.make()` para escrituras.
- Placeholders: `?` nativo.

Instalación
```bash
npm install mysql2
```

Configuración
```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { MysqlExecutor } from 'iagate-querykit/adapters/mysql'

setDefaultExecutor(new MysqlExecutor({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'secret',
  database: 'app',
  connectionLimit: 10,
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

- El builder usa `?`; `mysql2` los acepta tal cual.

Transacciones

Básico (BEGIN/COMMIT):
```ts
import { QueryKitConfig } from 'iagate-querykit'
const exec = QueryKitConfig.defaultExecutor!

await exec.executeQuery('BEGIN', [])
await exec.executeQuery('INSERT INTO users (email, active) VALUES (?, ?)', ['x@y.com', 1])
await exec.executeQuery('UPDATE users SET active = ? WHERE id = ?', [0, 1])
await exec.executeQuery('COMMIT', [])
```

Con SAVEPOINT/ROLLBACK:
```ts
await exec.executeQuery('BEGIN', [])
await exec.executeQuery('SAVEPOINT sp1', [])
await exec.executeQuery('INSERT INTO users (email) VALUES (?)', ['rollback@example.com'])
await exec.executeQuery('ROLLBACK TO SAVEPOINT sp1', [])
await exec.executeQuery('COMMIT', [])
```

Con manejo de errores:
```ts
await exec.executeQuery('BEGIN', [])
try {
  await exec.executeQuery('INSERT INTO orders (user_id, total) VALUES (?, ?)', [1, 100])
  await exec.executeQuery('SAVEPOINT after_order', [])
  await exec.executeQuery('UPDATE users SET balance = balance - ? WHERE id = ?', [100, 1])
  await exec.executeQuery('COMMIT', [])
} catch (e) {
  await exec.executeQuery('ROLLBACK', [])
}
```

Ajustes del pool

- `connectionLimit`: tamaño máximo del pool (predeterminado 10). Ajusta según la carga.

Solución de problemas

- ER_ACCESS_DENIED_ERROR: verifica credenciales.
- PROTOCOL_CONNECTION_LOST: incrementa el pool y maneja reconexiones.
- Timeouts: ajusta `wait_timeout`/`connectTimeout`. 