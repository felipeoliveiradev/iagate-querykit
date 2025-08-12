---
id: triggers-sql
title: Triggers (SQLite)
---

`TriggerManager` (SQL level) creates and removes triggers directly in SQLite.

```ts
// Methods
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

Create trigger:
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

List triggers:
```ts
const names = tm.listTriggers()
```

Check existence:
```ts
const ok = tm.triggerExists('orders_set_updated_at')
```

Drop trigger:
```ts
tm.dropTrigger('orders_set_updated_at')
``` 