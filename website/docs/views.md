---
id: views
title: Views
---

`ViewManager` gerencia views SQLite e refresh agendado.

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

Exemplo básico:
```ts
import { ViewManager, QueryBuilder } from 'iagate-querykit'

const views = new ViewManager()
const q = new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)

views.createOrReplaceView('active_users', q)
views.scheduleViewRefresh('active_users', q, 10 * 60 * 1000)
```

Cancelar agendamento:
```ts
views.unscheduleViewRefresh('active_users')
```

Remover view:
```ts
views.dropView('active_users')
```

Listar e checar existência:
```ts
const list = views.listViews()
const exists = views.viewExists('active_users')
```

Obter builder para a view:
```ts
// Obter um QueryBuilder para a view e ler dados
type Row = { id: number; email: string }
const rows = await views.view<Row>('active_users')
  .orderBy('id', 'DESC')
  .all()
``` 