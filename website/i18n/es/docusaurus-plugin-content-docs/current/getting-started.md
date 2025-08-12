---
id: getting-started
title: Comenzando
---

### Instalar

```bash
npm install iagate-querykit
# ejecutor opcional
npm install better-sqlite3
```

### Configuración básica

```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

setDefaultExecutor(new BetterSqlite3Executor('app.sqlite'))
```

### Primera consulta

```ts
import { QueryBuilder } from 'iagate-querykit'

const users = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .orderBy('created_at', 'DESC')
  .limit(10)
  .all()
``` 