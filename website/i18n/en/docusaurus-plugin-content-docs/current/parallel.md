---
id: parallel
title: Parallel
---

```ts
// Method
parallel(...queries: QueryBuilder<any>[]): Promise<any[]>
```

Rule: pending writes (`hasPendingWrite()`) use `.make()`. Everything else uses `.all()`.

Example (reads + writes):
```ts
import { parallel, QueryBuilder } from 'iagate-querykit'

const results = await parallel(
  new QueryBuilder('users')
    .select(['id'])
    .orderBy('id', 'DESC')
    .limit(2),
  new QueryBuilder('orders')
    .insert({ id: 10, amount: 99 }),
)
// results[0] -> rows
// results[1] -> { changes, lastInsertRowid }
``` 