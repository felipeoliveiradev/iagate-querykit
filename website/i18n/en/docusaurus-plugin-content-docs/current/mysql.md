---
id: mysql
title: MySQL
---

Overview

- Executor: `MysqlExecutor` (driver `mysql2/promise`).
- Fully async; works with `QueryBuilder.make()` for writes.
- Placeholders: native `?`.

Install
```bash
npm install mysql2
```

Config
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

Reads (SELECT)
```ts
const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .orderBy('id', 'DESC')
  .limit(10)
  .all()
```

Writes (INSERT/UPDATE/DELETE)
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Placeholders

- The builder uses `?` bindings; `mysql2` accepts them as-is.

Transactions

Basic (BEGIN/COMMIT):
```ts
import { QueryKitConfig } from 'iagate-querykit'
const exec = QueryKitConfig.defaultExecutor!

await exec.executeQuery('BEGIN', [])
await exec.executeQuery('INSERT INTO users (email, active) VALUES (?, ?)', ['x@y.com', 1])
await exec.executeQuery('UPDATE users SET active = ? WHERE id = ?', [0, 1])
await exec.executeQuery('COMMIT', [])
```

With SAVEPOINT/ROLLBACK:
```ts
await exec.executeQuery('BEGIN', [])
await exec.executeQuery('SAVEPOINT sp1', [])
await exec.executeQuery('INSERT INTO users (email) VALUES (?)', ['rollback@example.com'])
await exec.executeQuery('ROLLBACK TO SAVEPOINT sp1', [])
await exec.executeQuery('COMMIT', [])
```

With error handling:
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

Pool tuning

- `connectionLimit`: max pool size (default 10). Adjust to your workload.

Troubleshooting

- ER_ACCESS_DENIED_ERROR: check credentials.
- PROTOCOL_CONNECTION_LOST: increase pool and handle reconnects.
- Timeouts: tweak `wait_timeout`/`connectTimeout`. 