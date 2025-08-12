---
id: multi-db
title: Multi-Base de Datos (fan‑out)
---

`MultiDatabaseManager` orquesta múltiples bases de datos.

APIs:
- `getInstance(config?)`
- `initialize(createAdapter: (config) => BaseDatabaseAdapter)`
- `getAdapter(name)` / `getDefaultAdapter()`
- `executeOnMultiple(databaseNames, sql, params?) => Record<string, QueryResult>`

Ejemplo:
```ts
import { MultiDatabaseManager } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

const multi = MultiDatabaseManager.getInstance({
  defaultDatabase: 'primary',
  databases: {
    primary: { name: 'primary', type: 'sqlite', filePath: 'db1.sqlite' },
    analytics: { name: 'analytics', type: 'sqlite', filePath: 'db2.sqlite' },
  },
})
await multi.initialize(({ filePath }) => new BetterSqlite3Executor(filePath!))
const out = await multi.executeOnMultiple(['primary','analytics'], 'SELECT COUNT(*) as c FROM users')
``` 