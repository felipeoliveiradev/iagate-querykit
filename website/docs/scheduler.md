---
id: scheduler
title: Scheduler
---

```ts
// Métodos
schedule(name: string, task: () => void, intervalMs: number): void
unschedule(name: string): void
```

Exemplos:
```ts
import { scheduler } from 'iagate-querykit'

scheduler.schedule('nightly', () => {
  // tarefas
}, 24 * 60 * 60 * 1000)

scheduler.unschedule('nightly')

// re-agendar com outro intervalo
scheduler.schedule('nightly', () => {}, 60 * 60 * 1000)
``` 