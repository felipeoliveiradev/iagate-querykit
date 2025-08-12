---
id: scheduler
title: Scheduler
---

```ts
// Methods
schedule(name: string, task: () => void, intervalMs: number): void
unschedule(name: string): void
```

Examples:
```ts
import { scheduler } from 'iagate-querykit'

scheduler.schedule('nightly', () => {
  // tasks
}, 24 * 60 * 60 * 1000)

scheduler.unschedule('nightly')

// re-schedule with another interval
scheduler.schedule('nightly', () => {}, 60 * 60 * 1000)
``` 