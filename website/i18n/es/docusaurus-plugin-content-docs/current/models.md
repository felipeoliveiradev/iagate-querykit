---
id: models
title: Modelos
---

`Model` ofrece llenado seguro (fillable/guarded) y `save()`/`delete()` para insertar/actualizar/eliminar.

```ts
// APIs
static query<T extends Model>(): QueryBuilder<T>
fill(attributes: Record<string, any>): void
save(): Promise<any>
delete(): Promise<any>

// Campos de configuración
protected static tableName: string
protected fillable: string[] = []
protected guarded: string[] = ['id', 'created_at', 'updated_at']
```

Clase base y comportamiento:
```ts
import { Model } from 'iagate-querykit'

class User extends Model {
  protected static tableName = 'users'
  protected fillable = ['email', 'active']
}
```

Insert respetando fillable:
```ts
const u = new User()
u.fill({ id: 999, email: 'a@b.com', active: 1, role: 'admin' })
await u.save() // INSERT email, active
```

Guarded por defecto:
```ts
class Log extends Model {
  protected static tableName = 'logs'
  // guarded: id, created_at, updated_at
}
const l = new Log() as any
l.id = 10
l.created_at = 'NO'
l.message = 'ok'
await l.save() // INSERT message
```

Update cuando id presente:
```ts
class Post extends Model { static tableName = 'posts' }
const p = new Post() as any
p.id = 1
p.fill({ title: 'New', created_at: 'forbidden' })
await p.save() // UPDATE title WHERE id = 1
```

Consulta estática:
```ts
class Account extends Model { static tableName = 'accounts' }
const rows = await Account.query<Account>().select(['id']).all()
```

Ignorar campos no fillable:
```ts
class Product extends Model {
  static tableName = 'products'
  protected fillable = ['name']
}
const pr = new Product()
pr.fill({ name: 'N', price: 100 }) // price ignorado
await pr.save() // INSERT name
```

Combinar con QueryBuilder manualmente:
```ts
class Company extends Model { static tableName = 'companies' }
await Company.query<Company>().where('id', '=', 1).update({ name: 'X' }).make()
```

Eliminar por id:
```ts
const d = new User() as any
d.id = 7
await d.delete() // DELETE FROM users WHERE id = 7
``` 