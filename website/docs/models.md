---
id: models
title: Models
---

`Model` oferece preenchimento seguro (fillable/guarded) e `save()`/`delete()` para insert/update/delete.

```ts
// APIs
static query<T extends Model>(): QueryBuilder<T>
fill(attributes: Record<string, any>): void
save(): Promise<any>
delete(): Promise<any>

// Campos de configuração
protected static tableName: string
protected fillable: string[] = []
protected guarded: string[] = ['id', 'created_at', 'updated_at']
```

Classe base e comportamento:
```ts
import { Model } from 'iagate-querykit'

class User extends Model {
  protected static tableName = 'users'
  protected fillable = ['email', 'active']
}
```

Insert respeitando fillable:
```ts
const u = new User()
u.fill({ id: 999, email: 'a@b.com', active: 1, role: 'admin' })
await u.save() // INSERT email, active
```

Guarded padrão:
```ts
class Log extends Model {
  protected static tableName = 'logs'
  // guarded: id, created_at, updated_at
}
const l = new Log() as any
l.id = 10
l.created_at = 'NAO'
l.message = 'ok'
await l.save() // INSERT message
```

Update quando id presente:
```ts
class Post extends Model { static tableName = 'posts' }
const p = new Post() as any
p.id = 1
p.fill({ title: 'New', created_at: 'forbidden' })
await p.save() // UPDATE title WHERE id = 1
```

Static query:
```ts
class Account extends Model { static tableName = 'accounts' }
const rows = await Account.query<Account>().select(['id']).all()
```

Ignorando campos não fillable:
```ts
class Product extends Model {
  static tableName = 'products'
  protected fillable = ['name']
}
const pr = new Product()
pr.fill({ name: 'N', price: 100 }) // price ignorado
await pr.save() // INSERT name
```

Combinar com QueryBuilder manualmente:
```ts
class Company extends Model { static tableName = 'companies' }
await Company.query<Company>().where('id', '=', 1).update({ name: 'X' }).make()
```

Delete por id:
```ts
const d = new User() as any
d.id = 7
await d.delete() // DELETE FROM users WHERE id = 7
``` 