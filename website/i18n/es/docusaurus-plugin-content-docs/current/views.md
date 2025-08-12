---
id: views
title: Vistas
---

`ViewManager` gestiona vistas SQLite y su actualización programada.

```ts
// Métodos
createOrReplaceView(viewName: string, query: QueryBuilder<any>): void
scheduleViewRefresh(viewName: string, query: QueryBuilder<any>, intervalMs: number): void
unscheduleViewRefresh(viewName: string): void
dropView(viewName: string): void
listViews(): string[]
viewExists(viewName: string): boolean
view<T extends Record<string, any>>(viewName: string): QueryBuilder<T>
```

Ejemplo básico:
```ts
import { ViewManager, QueryBuilder } from 'iagate-querykit'

const views = new ViewManager()
const q = new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)

views.createOrReplaceView('active_users', q)
views.scheduleViewRefresh('active_users', q, 10 * 60 * 1000)
```

Cancelar programación:
```ts
views.unscheduleViewRefresh('active_users')
```

Eliminar vista:
```ts
views.dropView('active_users')
```

Listar y verificar existencia:
```ts
const list = views.listViews()
const exists = views.viewExists('active_users')
```

Obtener builder para la vista:
```ts
// Obtener un QueryBuilder para la vista y leer datos
type Row = { id: number; email: string }
const rows = await views.view<Row>('active_users')
  .orderBy('id', 'DESC')
  .all()
``` 