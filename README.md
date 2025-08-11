## QueryKit (iagate-querykit)

Minimal, typed building blocks for SQL-centric data apps in TypeScript. Compose queries with `QueryBuilder`, manage views and triggers, schedule jobs, run simulations, and route to one or multiple databases. Includes a `better-sqlite3` executor.

### Install

```bash
npm install @iagate/querykit
# optional peer
npm install better-sqlite3
```

### Core Concepts

- `QueryBuilder<T>(table)`: Build SQL with a fluent API and execute via a configured executor.
- `ViewManager`: Create/drop views and schedule refreshes.
- `TriggerManager`: Create/drop SQLite triggers.
- `scheduler`: Simple interval scheduler with named tasks.
- `simulationManager`: Dry-run mode that executes against an in-memory virtual state.
- `MultiDatabaseManager`: Register and execute against multiple adapters.
- `BetterSqlite3Executor`: DatabaseExecutor for `better-sqlite3`.

### Configure an executor

```ts
import { setDefaultExecutor } from '@iagate/querykit'
import { BetterSqlite3Executor } from '@iagate/querykit/adapters/better-sqlite3'

setDefaultExecutor(new BetterSqlite3Executor('app.sqlite'))
```

### Queries

```ts
import { QueryBuilder } from '@iagate/querykit'

// SELECT id, email FROM users WHERE active = 1 ORDER BY created_at DESC LIMIT 50
const users = await new QueryBuilder<{ id: number; email: string; active: number }>('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .orderBy('created_at', 'DESC')
  .limit(50)
  .all()

// Aggregates
const total = await new QueryBuilder('orders').count().scalarSync<number>('count')

// Insert / Update / Delete
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

### Raw expressions, IN/NULL/BETWEEN, subqueries

```ts
import { raw, QueryBuilder } from '@iagate/querykit'

const rows = await new QueryBuilder('users')
  .select(['id'])
  .whereIn('id', [1, 2, 3])
  .whereNull('deleted_at')
  .whereBetween('created_at', ['2025-01-01', '2025-12-31'])
  .havingRaw('COUNT(id) > 0')
  .selectRaw('strftime("%Y-%m", created_at) AS ym')
  .all()

// EXISTS
const sub = new QueryBuilder('orders').select(['user_id']).where('amount', '>', 0)
const exists = await new QueryBuilder('users').whereExists(sub).limit(1).exists()
```

### Views

```ts
import { ViewManager, QueryBuilder } from '@iagate/querykit'

const views = new ViewManager()
views.createOrReplaceView(
  'active_users',
  new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1),
)

// schedule refresh every 10 minutes
views.scheduleViewRefresh(
  'active_users',
  new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1),
  10 * 60 * 1000,
)
```

### Triggers (SQLite)

```ts
import { TriggerManager } from '@iagate/querykit'

const triggers = new TriggerManager()
triggers.createTrigger(
  'users_update_timestamp',
  'users',
  'BEFORE',
  'UPDATE',
  `
    SET NEW.updated_at = CURRENT_TIMESTAMP;
  `,
)
```

### Scheduler

```ts
import { scheduler } from '@iagate/querykit'

scheduler.schedule('nightly-maintenance', () => {
  // rotate tokens, refresh views, etc.
}, 24 * 60 * 60 * 1000)
```

### Parallel

```ts
import { parallel, QueryBuilder } from '@iagate/querykit'

const [recentUsers, topOrders] = await parallel(
  new QueryBuilder('users').select(['id']).orderBy('created_at', 'DESC').limit(10),
  new QueryBuilder('orders').select(['id']).orderBy('amount', 'DESC').limit(5),
)
```

### Simulation (dry-run)

```ts
import { simulationManager, QueryBuilder } from '@iagate/querykit'

await simulationManager.start({
  users: [
    { id: 1, email: 'a@b.com', active: 1 },
    { id: 2, email: 'c@d.com', active: 0 },
  ],
})

const q = new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .limit(1)

// dry run
const one = await q.all<{ id: number; email: string }>()

// track writes without touching DB
await new QueryBuilder('users').insert({ id: 3, email: 'x@y.com', active: 1 }).initial(one).tracking()

simulationManager.stop()
```

### Multi-database execution

```ts
import { MultiDatabaseManager } from '@iagate/querykit'

const multi = MultiDatabaseManager.getInstance({
  defaultDatabase: 'primary',
  databases: {
    primary: { name: 'primary', type: 'sqlite', filePath: 'db1.sqlite' },
    analytics: { name: 'analytics', type: 'sqlite', filePath: 'db2.sqlite' },
  },
})

await multi.initialize(({ filePath }) => new BetterSqlite3Executor(filePath!))

const results = await multi.executeOnMultiple(
  ['primary', 'analytics'],
  'SELECT COUNT(*) as c FROM users',
)
```

### Makefile

Common tasks:

- build: `make build`
- test: `make test`
- publish: `make publish`

### License

MIT

---

## Advanced Examples with Expected Output

### 1) Tracking: dry-run mutations with virtual table state

```ts
import { QueryBuilder, simulationManager } from '@iagate/querykit'

await simulationManager.start({
  users: [
    { id: 1, email: 'a@b.com', active: 1 },
    { id: 2, email: 'c@d.com', active: 0 },
  ],
})

const q = new QueryBuilder<{ id: number; email: string; active: number }>('users')
  .insert({ id: 3, email: 'x@y.com', active: 1 })

await q.initial().tracking()

// Expected virtual state for 'users' (no real DB touched):
// [
//   { id: 1, email: 'a@b.com', active: 1 },
//   { id: 2, email: 'c@d.com', active: 0 },
//   { id: 3, email: 'x@y.com', active: 1 },
// ]

simulationManager.stop()
```

### 2) Parallel orchestration (reads and writes mixed)

```ts
import { parallel, QueryBuilder } from '@iagate/querykit'

const results = await parallel(
  new QueryBuilder('users').select(['id']).orderBy('id', 'DESC').limit(2),
  new QueryBuilder('orders').insert({ id: 10, amount: 99 }),
)

// Expected:
// results[0] -> last 2 users rows
// results[1] -> { changes: 1, lastInsertRowid: 10 }
```

### 3) Multi-database fan-out

```ts
import { MultiDatabaseManager } from '@iagate/querykit'

const multi = MultiDatabaseManager.getInstance({
  defaultDatabase: 'primary',
  databases: {
    primary: { name: 'primary', type: 'sqlite', filePath: 'db1.sqlite' },
    analytics: { name: 'analytics', type: 'sqlite', filePath: 'db2.sqlite' },
  },
})

await multi.initialize(({ filePath }) => new BetterSqlite3Executor(filePath!))

const out = await multi.executeOnMultiple([
  'primary',
  'analytics',
], 'SELECT COUNT(*) as c FROM users')

// Expected shape:
// {
//   primary:  { data: [{ c: 42 }] },
//   analytics:{ data: [{ c: 42 }] },
// }
```

### 4) Unions and pagination

```ts
import { QueryBuilder } from '@iagate/querykit'

const a = new QueryBuilder('users').select(['id', 'email']).where('active', '=', 1)
const b = new QueryBuilder('users').select(['id', 'email']).where('active', '=', 0)

const unioned = a.unionAll(b).orderBy('id', 'DESC').paginate(2, 10)
const { sql, bindings } = unioned.toSql()

// Expected SQL:
// (SELECT id, email FROM users WHERE id = ? /*...*/ ) UNION ALL (SELECT ...) ORDER BY id DESC LIMIT ? OFFSET ?
// Expected bindings length: >= 3
```

### 5) Aggregations with CASE expressions

```ts
import { QueryBuilder } from '@iagate/querykit'

const q = new QueryBuilder('users')
  .selectCount('*', 'total')
  .selectCaseSum('active = 1', 'active_count')

const { sql } = q.toSql()
// Expected SQL contains:
// SELECT COUNT(*) AS total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_count FROM users
```

### 6) Range and period helpers

```ts
import { QueryBuilder } from '@iagate/querykit'

const last7d = new QueryBuilder('logins')
  .period('created_at', '7d')
  .select(['id'])

const last24h = new QueryBuilder('logins')
  .period('created_at', '24h')
  .select(['id'])

// Expected: Both produce WHERE created_at >= ? ISO timestamp bounds
```

### 7) Views + scheduled refresh with ViewManager

```ts
import { ViewManager, QueryBuilder } from '@iagate/querykit'

const views = new ViewManager()
const q = new QueryBuilder('events')
  .select(['user_id'])
  .whereRaw('timestamp >= datetime("now", "-1 day")')

views.createOrReplaceView('active_last_day', q)
views.scheduleViewRefresh('active_last_day', q, 15 * 60 * 1000)

// Expected: a SQLite view named active_last_day exists and will refresh every 15m
```

### 8) Triggers with BEFORE/AFTER timing

```ts
import { TriggerManager } from '@iagate/querykit'

const triggers = new TriggerManager()
triggers.createTrigger(
  'orders_set_updated_at',
  'orders',
  'BEFORE',
  'UPDATE',
  `SET NEW.updated_at = CURRENT_TIMESTAMP;`
)

// Expected: a trigger exists in sqlite_master for 'orders_set_updated_at'
```

### 9) Models and fillable/guarded fields

```ts
import { Model } from '@iagate/querykit'

class User extends Model {
  protected static tableName = 'users'
  protected fillable = ['email', 'active']
}

const u = new User()
u.fill({ id: 999, email: 'x@y.com', active: 1 })
await u.save()

// Expected: INSERT only email and active (id is guarded)
```

### 10) Table helper

```ts
import { table } from '@iagate/querykit'

const Users = table<{ id: number; email: string }>('users')
const first = Users.orderBy('id', 'ASC').firstSync<{ id: number; email: string }>()

// Expected: { id, email } of the first row
```

