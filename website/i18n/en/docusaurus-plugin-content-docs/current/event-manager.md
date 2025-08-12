---
id: event-manager
title: Event Manager
---

`eventManager` provides local `on/off/emit` and delegates to `QueryKitConfig.eventBus` if configured.

APIs:
- `on(event, listener): () => off()`
- `off(event, listener)`
- `emit(event, ...args)`

```ts
import { eventManager } from 'iagate-querykit'
const off = eventManager.on('x', (payload) => {})
eventManager.emit('x', { ok: 1 })
off()
``` 