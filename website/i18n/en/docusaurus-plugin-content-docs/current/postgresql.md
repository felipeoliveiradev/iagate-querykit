---
id: postgresql
title: PostgreSQL
---

Overview

- Executor: `PostgresExecutor` (driver `pg`).
- Async; works with `QueryBuilder.make()`.
- Converts `?` to `$1, $2, ...`.

Install
```bash
npm install pg
```

Config
```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { PostgresExecutor } from 'iagate-querykit/adapters/postgresql'

setDefaultExecutor(new PostgresExecutor({
  connectionString: 'postgres://user:pass@localhost:5432/app',
  poolSize: 10,
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

- Builder uses `?`; adapter converts to `$1, $2, ...`.

Transactions

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
await exec.executeQuery('ROLLBACK TO sp1', [])
await exec.executeQuery('COMMIT', [])
```

On error → full rollback:
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

- `poolSize`: max connections (default 10). Adjust to load.

Troubleshooting

- Auth errors: check credentials.
- SSL: provide `ssl` if required. 