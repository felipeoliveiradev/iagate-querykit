---
id: scheduler
title: Programador
---

```ts
// Métodos
schedule(name: string, task: () => void, intervalMs: number): void
unschedule(name: string): void
```

Ejemplos:
```ts
import { scheduler } from 'iagate-querykit'

scheduler.schedule('nightly', () => {
  // tareas
}, 24 * 60 * 60 * 1000)

scheduler.unschedule('nightly')

// reprogramar con otro intervalo
scheduler.schedule('nightly', () => {}, 60 * 60 * 1000)
``` 