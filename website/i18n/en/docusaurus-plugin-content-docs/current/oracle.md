---
id: oracle
title: Oracle
---

Overview

- Executor: `OracleExecutor` (driver `oracledb`).
- Async; works with `QueryBuilder.make()`.
- Converts `?` to `:1, :2, ...`.

Install
```bash
npm install oracledb
```

Config
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

Reads (SELECT)
```ts
const rows = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .all()
```

Writes (INSERT/UPDATE/DELETE)
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Placeholders

- Adapter converts `?` to `:1, :2, ...`.

Transactions

Note: adapter uses `autoCommit: true`. For multi‑statement transactions, drive them with explicit control statements.

Basic:
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

On error → rollback:
```ts
await exec.executeQuery('BEGIN', [])
try {
  await exec.executeQuery('INSERT INTO logs (payload) VALUES (?)', ['ok'])
  await exec.executeQuery('COMMIT', [])
} catch {
  await exec.executeQuery('ROLLBACK', [])
}
```

Native deps

- `oracledb` requires native libraries (Oracle Instant Client) installed. 