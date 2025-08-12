---
id: adapters-and-executors
title: Adapters and Executors
---

### DatabaseExecutor (for QueryBuilder)
```ts
interface DatabaseExecutor {
  executeQuery(sql: string, bindings: any[]): Promise<{ data: any[]; affectedRows?: number; lastInsertId?: number | string }>
  executeQuerySync?(sql: string, bindings: any[]): { data: any[]; affectedRows?: number; lastInsertId?: number | string }
  runSync?(sql: string, bindings: any[]): { changes: number; lastInsertRowid: number | bigint }
}
```

Set default executor:
```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

setDefaultExecutor(new BetterSqlite3Executor('app.sqlite'))
```

### BaseDatabaseAdapter (for Multi-DB)
```ts
abstract class BaseDatabaseAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnectedToDatabase(): boolean
  executeQuery(sql: string, params?: any[]): Promise<{
    data: any[]
    affectedRows?: number
    lastInsertId?: number | string
    metadata?: Record<string, any>
  }>
}
```

Minimal adapter example:
```ts
import { BaseDatabaseAdapter } from 'iagate-querykit'

class MyAdapter extends BaseDatabaseAdapter {
  private connected = false
  async connect() { this.connected = true }
  async disconnect() { this.connected = false }
  isConnectedToDatabase() { return this.connected }
  async executeQuery(sql: string, params?: any[]) { return { data: [] } }
}
```

Use with Multi-DB:
```ts
import { MultiDatabaseManager } from 'iagate-querykit'
const cfg = { defaultDatabase: 'a', databases: { a: { name: 'a', type: 'sqlite' } } }
const mdm = MultiDatabaseManager.getInstance(cfg)
await mdm.initialize((c) => new MyAdapter(c))
const result = await mdm.executeOnMultiple(['a'], 'SELECT 1')
``` 