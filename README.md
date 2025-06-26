## QueryKit (@iagate/querykit)

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

