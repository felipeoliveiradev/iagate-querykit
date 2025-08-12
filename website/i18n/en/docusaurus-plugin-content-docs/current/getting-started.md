---
id: getting-started
title: Getting Started
---

### Install

```bash
npm install iagate-querykit
# optional executor
npm install better-sqlite3
```

### Basic setup

```ts
import { setDefaultExecutor } from 'iagate-querykit'
import { BetterSqlite3Executor } from 'iagate-querykit/adapters/better-sqlite3'

setDefaultExecutor(new BetterSqlite3Executor('app.sqlite'))
```

### First query

```ts
import { QueryBuilder } from 'iagate-querykit'

const users = await new QueryBuilder('users')
  .select(['id', 'email'])
  .where('active', '=', 1)
  .orderBy('created_at', 'DESC')
  .limit(10)
  .all()
``` 