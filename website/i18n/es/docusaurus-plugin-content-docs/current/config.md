---
id: config
title: Configuración
---

`QueryKitConfig` y setters:

- `QueryKitConfig`: `{ defaultExecutor?, eventBus?, simulation?, multiDb? }`
- `setDefaultExecutor(executor)`
- `setEventBus(bus)`
- `setSimulationController(sim)`
- `setMultiDbRegistry(reg)`

```ts
import { setDefaultExecutor, setEventBus, setSimulationController, setMultiDbRegistry } from 'iagate-querykit'
``` 