---
id: mysql
title: MySQL
---

Visão geral

- Executor: `MysqlExecutor` (driver `mysql2/promise`).
- Totalmente assíncrono; compatível com `QueryBuilder.make()` (writes).
- Placeholders suportados: `?` (nativos do `mysql2`).

Instalação
```bash
npm install mysql2
```

Configuração
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

Leituras (SELECT)
```ts
import { QueryBuilder } from 'iagate-querykit'

const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .orderBy('id', 'DESC')
  .limit(10)
  .all()
```

Escritas (INSERT/UPDATE/DELETE)
```ts
// INSERT
await new QueryBuilder('users')
  .insert({ email: 'a@b.com', active: 1 })
  .make()

// UPDATE
await new QueryBuilder('users')
  .where('id', '=', 1)
  .update({ active: 0 })
  .make()

// DELETE
await new QueryBuilder('users')
  .where('id', '=', 2)
  .delete()
  .make()
```

Placeholders

- O `QueryBuilder` usa `?` para bindings. O `mysql2` aceita `?` diretamente.
- Nenhuma conversão adicional é necessária.

Transações

O `DatabaseExecutor` não expõe API de transação. Use SQL bruto.

Básico (BEGIN/COMMIT):
```ts
import { QueryKitConfig } from 'iagate-querykit'
const exec = QueryKitConfig.defaultExecutor!

await exec.executeQuery('BEGIN', [])
await exec.executeQuery('INSERT INTO users (email, active) VALUES (?, ?)', ['x@y.com', 1])
await exec.executeQuery('UPDATE users SET active = ? WHERE id = ?', [0, 1])
await exec.executeQuery('COMMIT', [])
```

Com SAVEPOINT/ROLLBACK:
```ts
await exec.executeQuery('BEGIN', [])
await exec.executeQuery('SAVEPOINT sp1', [])
await exec.executeQuery('INSERT INTO users (email) VALUES (?)', ['rollback@example.com'])
await exec.executeQuery('ROLLBACK TO SAVEPOINT sp1', [])
await exec.executeQuery('COMMIT', [])
```

Com tratamento de erro:
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

Ajustes de pool

- `connectionLimit`: número máximo de conexões no pool (padrão 10).
- Ajuste conforme concorrência do aplicativo.

Soluções de problemas

- ER_ACCESS_DENIED_ERROR: verifique `user/password`. 
- PROTOCOL_CONNECTION_LOST: aumente `connectionLimit` e monitore reconexões.
- Timeouts: ajuste `wait_timeout`/`connectTimeout` (ver docs `mysql2`). 