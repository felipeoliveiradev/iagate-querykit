---
id: event-manager
title: Gestor de Eventos
---

`eventManager` provee `on/off/emit` local y delega a `QueryKitConfig.eventBus` si está configurado.

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