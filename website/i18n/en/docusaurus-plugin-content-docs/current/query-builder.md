---
id: query-builder
title: QueryBuilder
---

`QueryBuilder<T>(table)` is a fluent API to build typed SQL and execute via a configured executor.

```ts
// Construction & tracking
new QueryBuilder<T extends Record<string, any>>(table: string)
initial(data?: T[]): Promise<this>
tracking(): { step: string; details: any; timestamp: Date }[]
```

Selection / projection:
```ts
select(columns?: (keyof T | string)[]): this
selectRaw(sql: string): this
aggregatesSelect(columns: string[]): this
distinct(): this
```

Filters (WHERE):
```ts
where(column: keyof T | string, operator: Operator, value: any): this
orWhere(column: keyof T | string, operator: Operator, value: any): this
whereIf(condition: any, column: keyof T | string, operator: Operator, value: any): this
whereAll(conditions: Partial<T>): this
whereIn(column: keyof T | string, values: any[]): this
orWhereIn(column: keyof T | string, values: any[]): this
whereNotIn(column: keyof T | string, values: any[]): this
orWhereNotIn(column: keyof T | string, values: any[]): this
whereNull(column: keyof T | string): this
orWhereNull(column: keyof T | string): this
whereNotNull(column: keyof T | string): this
orWhereNotNull(column: keyof T | string): this
whereBetween(column: keyof T | string, values: [any, any]): this
whereNotBetween(column: keyof T | string, values: [any, any]): this
whereColumn(first: keyof T | string, op: Operator, second: keyof T | string): this
whereRaw(sql: string, bindings?: any[], logical?: 'AND' | 'OR'): this
whereRawSearch(searchTerm: string, columns: (keyof T | string)[]): this
whereExists(query: QueryBuilder<any>): this
whereNotExists(query: QueryBuilder<any>): this
```

Conditional flow & cloning:
```ts
when(condition: any, cb: (query: this, value: any) => void): this
unless(condition: any, cb: (query: this, value: any) => void): this
clone(): this
```

JOINs:
```ts
innerJoin(table: string, on: string): this
leftJoin(table: string, on: string): this
rightJoin(table: string, on: string): this
innerJoinOn(target: string, left: string, right: string): this
leftJoinOn(target: string, left: string, right: string): this
rightJoinOn(target: string, left: string, right: string): this
```

Grouping / HAVING / Ordering / Pagination:
```ts
groupBy(columns: (keyof T | string)[]): this
groupByOne(column: keyof T | string): this
having(column: keyof T | string, op: Operator, value: any): this
havingRaw(sql: string, bindings?: any[], logical?: 'AND' | 'OR'): this
havingIf(condition: any, column: keyof T | string, op: Operator, value: any): this
orderBy(column: keyof T | string, direction?: 'ASC' | 'DESC'): this
orderByMany(list: { column: string; direction?: 'ASC' | 'DESC' }[]): this
limit(n: number): this
offset(n: number): this
paginate(page?: number, perPage?: number): this
```

Aggregations & expressions:
```ts
count(column?: string, alias?: string): this
sum(column: string, alias?: string): this
avg(column: string, alias?: string): this
min(column: string, alias?: string): this
max(column: string, alias?: string): this
selectExpression(expression: string, alias?: string): this
selectCount(column?: string, alias?: string): this
selectSum(column: string, alias?: string): this
selectAvg(column: string, alias?: string): this
selectMin(column: string, alias?: string): this
selectMax(column: string, alias?: string): this
selectCaseSum(conditionSql: string, alias: string): this
```

Time & union:
```ts
range(field: keyof T | string, start?: Date, end?: Date): this
period(field: keyof T | string, key?: '24h' | '7d' | '30d' | string): this
union(query: QueryBuilder<any>): this
unionAll(query: QueryBuilder<any>): this
```

Compilation & execution:
```ts
toSql(): { sql: string; bindings: any[] }
all<U = T>(): Promise<U[]>
exists(): Promise<boolean>
pluck(column: keyof T): Promise<any[]>
run(): any
allSync<U = T>(): U[]
getSync<U = T>(): U | undefined
firstSync<U = T>(): U | undefined
pluckSync(column: keyof T | string): any[]
scalarSync<U = any>(alias?: string): U | undefined
get<U = T>(): U | undefined
first<U = T>(): U | undefined
find(id: string | number): T | undefined
```

Writes:
```ts
insert(data: Partial<T> | Partial<T>[]): this
update(data: Partial<T>): this
delete(): this
make(): Promise<{ changes: number; lastInsertRowid: number | bigint }>
```

Basic examples

Select/distinct:
```ts
new QueryBuilder('users')
  .select(['id', 'email'])
  .distinct()
```

Filters:
```ts
new QueryBuilder('users')
  .where('active', '=', 1)
  .whereIn('id', [1, 2, 3])
  .whereBetween('created_at', ['2025-01-01', '2025-12-31'])
  .whereRaw('(email LIKE ? OR name LIKE ?)', ['%a%', '%b%'])
```

JOIN and grouping:
```ts
new QueryBuilder('orders as o')
  .innerJoinOn('users as u', 'u.id', 'o.user_id')
  .select(['u.id', 'COUNT(o.id) as total'])
  .groupBy(['u.id'])
  .having('total' as any, '>', 5)
  .orderBy('u.id', 'DESC')
```

Pagination and time:
```ts
new QueryBuilder('users')
  .orderBy('created_at', 'DESC')
  .paginate(2, 25)

new QueryBuilder('logins')
  .period('created_at', '7d')
```

Aggregations:
```ts
new QueryBuilder('users')
  .selectCount('*', 'total')
  .selectCaseSum('active = 1', 'active_count')
```

Union:
```ts
const a = new QueryBuilder('users').select(['id']).where('active', '=', 1)
const b = new QueryBuilder('users').select(['id']).where('active', '=', 0)
a.unionAll(b)
```

Execution:
```ts
await new QueryBuilder('users').select(['id']).all()
new QueryBuilder('users').firstSync<{ id: number }>()
```

Writes:
```ts
await new QueryBuilder('users').insert({ email: 'a@b.com', active: 1 }).make()
await new QueryBuilder('users').where('id', '=', 1).update({ active: 0 }).make()
await new QueryBuilder('users').where('id', '=', 2).delete().make()
```

Tracking:
```ts
const qb = new QueryBuilder('users').insert({ id: 2, email: 'x@y.com', active: 1 })
await qb.initial([{ id: 1, email: 'a@b.com', active: 1 }])
const logs = qb.tracking()
``` 