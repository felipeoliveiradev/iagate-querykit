---
id: getting-started
title: Getting Started
---

### Instalação

```bash
npm install iagate-querykit
# optional drivers (install the ones you use)
npm install better-sqlite3
# npm install pg
# npm install mysql2
```

The package is dual ESM/CJS. `get()`, `first()`, and `find()` are async. Identifiers are quoted per dialect.

### Configuração básica

```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

setDefaultExecutor(new BetterSqlite3Executor('app.sqlite'))
```

### Primeira consulta

```ts
import { QueryBuilder } from 'iagate-querykit'

const users = await new QueryBuilder('users')
  .select(['id','email'])
  .where('active','=',1)
  .orderBy('created_at','DESC')
  .limit(10)
  .all()
``` 