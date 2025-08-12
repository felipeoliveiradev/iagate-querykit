---
id: raw-and-table
title: raw e table
---

`raw(sql)` e `table<T>(name)` são utilitários para composição.

```ts
// Assinaturas
raw(sql: string): { toSQL(): string }
table<T extends Record<string, any>>(tableName: string): QueryBuilder<T>
```

raw(sql):
```ts
import { raw, QueryBuilder } from 'iagate-querykit'

const q = new QueryBuilder('users')
  .select(['id', raw('strftime("%Y-%m", created_at) as ym')])
```

`table<T>(name)`:
```ts
import { table } from 'iagate-querykit'

const Users = table<{ id: number; email: string }>('users')
const first = Users
  .orderBy('id', 'ASC')
  .firstSync<{ id: number; email: string }>()
``` 