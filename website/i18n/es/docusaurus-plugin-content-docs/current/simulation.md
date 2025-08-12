---
id: simulation
title: Simulación (dry‑run)
---

```ts
// Métodos
isActive(): boolean
start(initialState: Record<string, any[] | QueryBuilder<any>>): Promise<void> | void
stop(): Promise<void> | void
getStateFor(tableName: string): any[] | undefined
updateStateFor(tableName: string, data: any[]): void
```

Ejemplo:
```ts
import { simulationManager, QueryBuilder } from 'iagate-querykit'

await simulationManager.start({ users: [{ id: 1, name: 'A' }] })

const rows = await new QueryBuilder('users').all()

await new QueryBuilder('users')
  .insert({ id: 2, name: 'B' })
  .initial(rows)
  .tracking()

simulationManager.stop()
``` 