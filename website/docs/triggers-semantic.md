---
id: triggers-semantic
title: Triggers Semânticos
---

Triggers semânticos (application-level) com `when`, `action`, `except`, `table` e `body`.

```ts
// Assinatura
create(
  name: string,
  opts: {
    when: 'BEFORE' | 'AFTER'
    action: 'INSERT' | 'UPDATE' | 'DELETE' | 'READ' | '*' | Array<'INSERT'|'UPDATE'|'DELETE'|'READ'|'*'>
    except?: Array<'INSERT'|'UPDATE'|'DELETE'|'READ'|'*'>
    table: string | string[]
    body: string | ((ctx) => any | Promise<any>) | Array<string | Function> | { parallel: Array<string | Function> }
  }
): void

// Contexto (ctx)
{
  table: string
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'READ'
  timing: 'BEFORE' | 'AFTER'
  data?: any
  where?: { sql: string; bindings: any[]; filters?: any[] }
  result?: { changes?: number; lastInsertRowid?: number | bigint }
  rows?: any[]
}
```

Exemplos

Criar BEFORE/AFTER INSERT:
```ts
import { TriggerManager, QueryBuilder } from 'iagate-querykit'
const tm = new TriggerManager()

await tm.create('audit_insert', {
  when: 'BEFORE', action: 'INSERT', table: 'users',
  body: `SELECT 1;`
})

await tm.create('audit_insert_after', {
  when: 'AFTER', action: 'INSERT', table: 'users',
  body: async (ctx) => {
    await new QueryBuilder('audit').insert({ action: ctx.action, table: ctx.table }).make()
  }
})
```

UPDATE com where:
```ts
await tm.create('after_update', {
  when: 'AFTER', action: 'UPDATE', table: 'users',
  body: (ctx) => console.log('WHERE SQL', ctx.where?.sql, 'bindings', ctx.where?.bindings)
})
```

DELETE:
```ts
await tm.create('after_delete', {
  when: 'AFTER', action: 'DELETE', table: 'users',
  body: `SELECT 1;`
})
```

READ hooks:
```ts
await tm.create('after_read', {
  when: 'AFTER', action: 'READ', table: 'users',
  body: (ctx) => console.log('rows', ctx.rows?.length)
})
```

action como array e table múltiplas:
```ts
await tm.create('multi_actions_tables', {
  when: 'AFTER', action: ['INSERT','UPDATE'], table: ['users','orders'],
  body: (ctx) => console.log(ctx.action, ctx.table)
})
```

except como array e wildcard:
```ts
await tm.create('except_sample', {
  when: 'AFTER', action: '*', except: ['READ','DELETE'], table: 'users',
  body: () => {}
})
```

body: string / função / array / paralelo:
```ts
await tm.create('body_string', { when: 'AFTER', action: 'INSERT', table: 'users', body: `SELECT 1;` })
await tm.create('body_fn', { when: 'AFTER', action: 'UPDATE', table: 'users', body: async (ctx) => {} })
await tm.create('body_array', { when: 'AFTER', action: 'DELETE', table: 'users', body: [`SELECT 1;`, async () => {}] })
await tm.create('body_parallel', { when: 'AFTER', action: 'INSERT', table: 'users', body: { parallel: [`SELECT 1;`, async () => {}] } })
``` 