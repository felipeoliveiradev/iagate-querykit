## QueryKit (iagate-querykit)

Typed SQL toolkit for TypeScript. Compose queries with `QueryBuilder`, manage views and triggers, schedule jobs, run simulations and migrations, and route to one or multiple databases.

First-party executors: SQLite (`better-sqlite3`), MySQL (`mysql2`), PostgreSQL (`pg`), Oracle (`oracledb`), SQL Server (`mssql`). Dual ESM/CJS package. Identifiers are quoted per dialect; values are bound.

See [CHANGELOG.md](./CHANGELOG.md) for 1.0.0 breaking changes and [RELEASE.md](./RELEASE.md) for npm publish (`NPM_TOKEN` secret required).

### Install

```bash
npm install iagate-querykit
# pick the driver(s) you use
npm install better-sqlite3
npm install pg
npm install mysql2
```

Works with `require` and `import`. TypeScript consumers can use `moduleResolution: NodeNext` or `bundler`.

### Core Concepts

- `QueryBuilder<T>(table)`: Build parameterized SQL with a fluent API.
- `ViewManager`: Create/drop views (dialect-aware) and schedule refreshes.
- `TriggerManager`: SQL triggers (dialect-aware DDL) plus in-process semantic triggers.
- `scheduler`: Interval scheduler (`schedule` / `unschedule` / `list` / `clear`).
- `simulationManager`: Dry-run mode against an in-memory virtual state.
- `MultiDatabaseManager`: Register executors or adapters and fan out queries.
- Executors: `BetterSqlite3Executor`, `PostgresExecutor`, `MysqlExecutor`, `OracleExecutor`, `SqlServerExecutor` — each implements `executeQuery`, `close()`, and `transaction()`.

---

## API catalog (by module)

### QueryBuilder<T>(tableName: string)
- Construction: `new QueryBuilder<T>(table)`
- Tracking/virtual: `initial(data?)`, `tracking()`
- Select: `select(columns)`, `selectRaw(sql)`, `aggregatesSelect(columns)`, `distinct()`
- Write ops (deferred): `insert(data)`, `update(data)`, `delete()`, `updateOrInsert(attrs, values)`, `increment(column, amount?)`, `decrement(column, amount?)`
- Where (basic and helpers):
  - `where(column, op, value)`, `orWhere(column, op, value)`, `whereIf(condition, ...)`, `whereAll(conditions)`
  - IN/NULL/BETWEEN: `whereIn`, `orWhereIn`, `whereNotIn`, `orWhereNotIn`, `whereNull`, `orWhereNull`, `whereNotNull`, `orWhereNotNull`, `whereBetween`, `whereNotBetween`
  - Column compare: `whereColumn(first, op, second)`
  - Raw/exists: `whereRaw(sql, bindings?, logical?)`, `whereRawSearch(searchTerm, columns)`, `whereExists(query)`, `whereNotExists(query)`
  - Fuzzy helpers: `whereLike`, `orWhereLike`, `whereContains`, `whereStartsWith`, `whereEndsWith`, `whereILike`, `whereContainsCI`, `whereStartsWithCI`, `whereEndsWithCI`, `whereSearch`
- When/unless/clone: `when(condition, cb)`, `unless(condition, cb)`, `clone()`
- Join: `innerJoin(table, on)`, `leftJoin(table, on)`, `rightJoin(table, on)`, `innerJoinOn(left, right)`, `leftJoinOn(left, right)`, `rightJoinOn(left, right)`
- Order/paging/group/having: `orderBy(column, dir?)`, `orderByMany([{ column, direction? }])`, `limit(n)`, `offset(n)`, `groupBy(columns)`, `groupByOne(column)`, `having(column, op, value)`, `havingRaw(sql, bindings?, logical?)`, `havingIf(condition, column, op, value)`
- Aggregates: `count(column?, alias?)`, `sum(column, alias?)`, `avg(column, alias?)`, `min(column, alias?)`, `max(column, alias?)`, `selectExpression(expr, alias?)`, `selectCount`, `selectSum`, `selectAvg`, `selectMin`, `selectMax`, `selectCaseSum(conditionSql, alias)`
- Time helpers: `paginate(page?, perPage?)`, `range(field, start?, end?)`, `period(field, key?)`
- Union: `union(query)`, `unionAll(query)`
- Compile: `toSql(): { sql, bindings }`
- Execute async: `all<U= T>()`, `exists()`, `pluck(column)`, `get<U>()`, `first<U>()`, `find(id)`
- Execute sync (SQLite / sync executors): `run()`, `allSync<U>()`, `getSync<U>()`, `firstSync<U>()`, `pluckSync(column)`, `scalarSync<U>(alias?)`
- Write now: `make()` (multi-row `insert` supported)
- `where(column, value)` is equality; `where(column, op, value)` for other operators
- Identifiers are quoted; `whereRaw` / `havingRaw` / join `ON` stay raw (caller-owned)

### ViewManager
- `createOrReplaceView(viewName, query)`
- `scheduleViewRefresh(viewName, query, intervalMs)`
- `unscheduleViewRefresh(viewName)`
- `dropView(viewName)`
- `listViews(): string[]`
- `viewExists(viewName): boolean`
- `view<T>(viewName): QueryBuilder<T>`

### TriggerManager
- SQL: `createTrigger(name, table, timing, event, body)` — dialect-specific DDL (SQLite `IF NOT EXISTS`, Postgres function+trigger, MySQL/MSSQL/Oracle variants)
- `dropTrigger(name)`, `listTriggers()` / `listTriggersAsync()`, `triggerExists()` / `triggerExistsAsync()`
- Semantic: `create(name, { when, action, table, body, except?, state? })`, `drop`, `list`, `dropAll`

### scheduler
- `schedule(name, task, intervalMs)` — `unref()`s the timer
- `unschedule(name)`, `list()`, `clear()`

### parallel
- `parallel(...queries: QueryBuilder[]): Promise<any[]>`

### simulationManager
- `isActive()`
- `start(initialState: Record<string, any[] | QueryBuilder<any>>)`
- `stop()`
- `getStateFor(tableName)`
- `updateStateFor(tableName, data)`

### MultiDatabaseManager
- `getInstance(config)` (throws if uninitialized), `resetInstance()`
- `initialize(create: (config) => DatabaseExecutor | BaseDatabaseAdapter)` — README-style `BetterSqlite3Executor` factories work
- `register(name, executor)`, `getAdapter(name)`, `getDefaultAdapter()`, `close()`
- `executeOnMultiple(databaseNames, sql, params?) => Record<string, QueryResult>`

### Config
- `QueryKitConfig`: `{ defaultExecutor?, eventBus?, simulation?, multiDb? }`
- Setters: `setDefaultExecutor(executor)`, `setEventBus(bus)`, `setSimulationController(sim)`, `setMultiDbRegistry(reg)`

### Helpers
- `raw(sql)`
- `table<T>(tableName)` → `QueryBuilder<T>`
- `Model`: `query()`, `withRelations()`, `seed()`, instance `fill`, `save` (writes generated id), `delete` (requires id)
- Migrations: `migrateUp`, `migrateDown`, `migration()` DSL, `runSeed`, `setRelations`
- `quoteIdent` / `UnsafeIdentifierError` from the package root

### Configure an executor

Preferred (instance, no process-wide singleton):

```ts
import { createQueryKit } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

const kit = createQueryKit(new BetterSqlite3Executor('app.sqlite'))
const users = await kit.table('users').where('active', '=', 1).all()
await kit.close()
```

Global default (still supported):

```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

setDefaultExecutor(new BetterSqlite3Executor('app.sqlite'))
// later
// await executor.close()
```

```ts
import { PostgresExecutor } from 'iagate-querykit/adapters/postgresql'
setDefaultExecutor(new PostgresExecutor({ connectionString: process.env.DATABASE_URL }))
```

### Queries

```ts
import { QueryBuilder } from 'iagate-querykit'

// SELECT id, email FROM users WHERE active = 1 ORDER BY created_at DESC LIMIT 50
const users = await new QueryBuilder<{ id: number; email: string; active: number }>('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .orderBy('created_at', 'DESC')
  .limit(50)
  .all()

// Aggregates
const total = new QueryBuilder('orders').count().scalarSync<number>('count')

// Insert / Update / Delete
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

### Raw expressions, IN/NULL/BETWEEN, subqueries

```ts
import { raw, QueryBuilder } from 'iagate-querykit'

const rows = await new QueryBuilder('users')
  .select(['id'])
  .whereIn('id', [1, 2, 3])
  .whereNull('deleted_at')
  .whereBetween('created_at', ['2025-01-01', '2025-12-31'])
  .selectRaw("strftime('%Y-%m', created_at) AS ym")
  .all()

const monthly = await new QueryBuilder('users')
  .selectRaw("strftime('%Y-%m', created_at) AS ym")
  .groupBy("strftime('%Y-%m', created_at)")
  .havingRaw('COUNT(id) > 0')
  .all()

// EXISTS
const sub = new QueryBuilder('orders').select(['user_id']).where('amount', '>', 0)
const exists = await new QueryBuilder('users').whereExists(sub).limit(1).exists()
```

### Views

```ts
import { ViewManager, QueryBuilder } from 'iagate-querykit'

const views = new ViewManager()
await views.createOrReplaceView(
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
import { TriggerManager } from 'iagate-querykit'

const triggers = new TriggerManager()
triggers.createTrigger(
  'users_ai',
  'users',
  'AFTER',
  'INSERT',
  `INSERT INTO audit (msg) VALUES ('ins')`,
)
```

### Scheduler

```ts
import { scheduler } from 'iagate-querykit'

scheduler.schedule('nightly-maintenance', () => {
  // rotate tokens, refresh views, etc.
}, 24 * 60 * 60 * 1000)
```

### Parallel

```ts
import { parallel, QueryBuilder } from 'iagate-querykit'

const [recentUsers, topOrders] = await parallel(
  new QueryBuilder('users').select(['id']).orderBy('created_at', 'DESC').limit(10),
  new QueryBuilder('orders').select(['id']).orderBy('amount', 'DESC').limit(5),
)
```

### Simulation (dry-run)

```ts
import { simulationManager, QueryBuilder } from 'iagate-querykit'

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
import { MultiDatabaseManager } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

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

### Transactions

```ts
await executor.transaction(async (tx) => {
  await tx.executeQuery('INSERT INTO users (email) VALUES (?)', ['a@b.com'])
  await tx.executeQuery('INSERT INTO audit (msg) VALUES (?)', ['created'])
})
```

### Makefile / release

- build: `make build`
- test: `make test`
- publish: GitHub Actions on `main` and GitHub Releases. The owner must add an `NPM_TOKEN` secret. See `RELEASE.md`. Do not `npm publish` from this PR.

### License

MIT

---

## Advanced Examples with Expected Output

### 1) Tracking: dry-run mutations with virtual table state

```ts
import { QueryBuilder, simulationManager } from 'iagate-querykit'

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
import { parallel, QueryBuilder } from 'iagate-querykit'

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
import { MultiDatabaseManager } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

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
import { QueryBuilder } from 'iagate-querykit'

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
import { QueryBuilder } from 'iagate-querykit'

const q = new QueryBuilder('users')
  .selectCount('*', 'total')
  .selectCaseSum('active = 1', 'active_count')

const { sql } = q.toSql()
// Expected SQL contains:
// SELECT COUNT(*) AS total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_count FROM users
```

### 6) Range and period helpers

```ts
import { QueryBuilder } from 'iagate-querykit'

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
import { ViewManager, QueryBuilder } from 'iagate-querykit'

const views = new ViewManager()
const q = new QueryBuilder('events')
  .select(['user_id'])
  .whereRaw('timestamp >= datetime("now", "-1 day")')

await views.createOrReplaceView('active_last_day', q)
views.scheduleViewRefresh('active_last_day', q, 15 * 60 * 1000)

// Expected: a SQLite view named active_last_day exists and will refresh every 15m
```

### 8) Triggers with BEFORE/AFTER timing

```ts
import { TriggerManager } from 'iagate-querykit'

const triggers = new TriggerManager()
triggers.createTrigger(
  'orders_ai',
  'orders',
  'AFTER',
  'INSERT',
  `INSERT INTO audit (msg) VALUES ('order')`
)

// Expected: a trigger exists in sqlite_master for 'orders_set_updated_at'
```

### 9) Models and fillable/guarded fields

```ts
import { Model } from 'iagate-querykit'

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
import { table } from 'iagate-querykit'

const Users = table<{ id: number; email: string }>('users')
const first = Users.orderBy('id', 'ASC').firstSync<{ id: number; email: string }>()

// Expected: { id, email } of the first row
```

