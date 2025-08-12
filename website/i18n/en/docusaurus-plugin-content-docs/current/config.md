---
id: config
title: Config
---

`QueryKitConfig` and setters:

- `QueryKitConfig`: `{ defaultExecutor?, eventBus?, simulation?, multiDb? }`
- `setDefaultExecutor(executor)`
- `setEventBus(bus)`
- `setSimulationController(sim)`
- `setMultiDbRegistry(reg)`

```ts
import { setDefaultExecutor, setEventBus, setSimulationController, setMultiDbRegistry } from 'iagate-querykit'
``` 