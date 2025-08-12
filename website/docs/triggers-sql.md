---
id: triggers-sql
title: Triggers (SQLite)
---

`TriggerManager` (nível SQL) cria e remove triggers diretamente no SQLite.

```ts
// Métodos
createTrigger(
  name: string,
  table: string,
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF',
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  body: string,
): void

dropTrigger(name: string): void
listTriggers(): string[]
triggerExists(name: string): boolean
```

Criar trigger:
```ts
import { TriggerManager } from 'iagate-querykit'

const tm = new TriggerManager()
tm.createTrigger(
  'orders_set_updated_at',
  'orders',
  'BEFORE',
  'UPDATE',
  `SET NEW.updated_at = CURRENT_TIMESTAMP;`,
)
```

Listar triggers:
```ts
const names = tm.listTriggers()
```

Checar existência:
```ts
const ok = tm.triggerExists('orders_set_updated_at')
```

Remover trigger:
```ts
tm.dropTrigger('orders_set_updated_at')
``` 