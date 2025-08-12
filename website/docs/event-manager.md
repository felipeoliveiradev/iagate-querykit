---
id: event-manager
title: Event Manager
---

`eventManager` provê `on/off/emit` local e delega para `QueryKitConfig.eventBus` (se configurado).

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