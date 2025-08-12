---
id: parallel
title: Paralelo
---

```ts
// Método
parallel(...queries: QueryBuilder<any>[]): Promise<any[]>
```

Regla: si `toSql()` empieza con `SELECT`, usa `.all()`. En caso contrario, `.run()`.

Ejemplo (lecturas + escrituras):
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
// results[0] -> filas
// results[1] -> { changes, lastInsertRowid }
``` 