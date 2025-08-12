---
id: triggers-sql
title: Disparadores (SQLite)
---

`TriggerManager` (nivel SQL) crea y elimina disparadores directamente en SQLite.

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

Crear disparador:
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

Listar disparadores:
```ts
const names = tm.listTriggers()
```

Verificar existencia:
```ts
const ok = tm.triggerExists('orders_set_updated_at')
```

Eliminar disparador:
```ts
tm.dropTrigger('orders_set_updated_at')
``` 