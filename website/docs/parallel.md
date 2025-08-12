---
id: parallel
title: Paralelo
---

```ts
// Método
parallel(...queries: QueryBuilder<any>[]): Promise<any[]>
```

Regra: se `toSql()` começar com `SELECT`, usa `.all()`. Caso contrário, `.run()`.

Exemplo (leitura + escrita):
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
// results[0] -> linhas
// results[1] -> { changes, lastInsertRowid }
``` 