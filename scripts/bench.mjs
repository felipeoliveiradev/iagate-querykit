#!/usr/bin/env node
/**
 * Real microbenchmarks for query compilation and SQLite round-trips.
 * Prints JSON so STUDY.md can quote exact numbers.
 */
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { QueryBuilder, setDefaultExecutor, resetQueryKitConfig, createQueryKit } from '../dist/index.js';
import { BetterSqlite3Executor } from '../dist/adapters/better-sqlite3.js';

function measure(name, n, fn) {
  const mem0 = process.memoryUsage();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn(i);
  const ms = performance.now() - t0;
  const mem1 = process.memoryUsage();
  return {
    name,
    iterations: n,
    totalMs: Number(ms.toFixed(2)),
    perOpUs: Number(((ms * 1000) / n).toFixed(2)),
    heapDeltaMb: Number(((mem1.heapUsed - mem0.heapUsed) / 1024 / 1024).toFixed(2)),
  };
}

async function measureAsync(name, n, fn) {
  const mem0 = process.memoryUsage();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await fn(i);
  const ms = performance.now() - t0;
  const mem1 = process.memoryUsage();
  return {
    name,
    iterations: n,
    totalMs: Number(ms.toFixed(2)),
    perOpUs: Number(((ms * 1000) / n).toFixed(2)),
    heapDeltaMb: Number(((mem1.heapUsed - mem0.heapUsed) / 1024 / 1024).toFixed(2)),
  };
}

resetQueryKitConfig();
const exec = new BetterSqlite3Executor(':memory:');
setDefaultExecutor(exec);
exec.executeQuerySync(
  'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, active INT)',
);

const results = [];

results.push(
  measure('toSql simple where+order+limit', 20_000, (i) => {
    new QueryBuilder('users').select(['id', 'email']).where('id', '=', i).orderBy('id').limit(10).toSql();
  }),
);

results.push(
  measure('toSql 8-clause where + join', 10_000, (i) => {
    new QueryBuilder('users as u')
      .select(['u.id', 'p.bio'])
      .innerJoinOn('profiles as p', 'p.user_id', 'u.id')
      .where('u.active', '=', 1)
      .where('u.email', 'LIKE', `%${i}%`)
      .whereIn('u.id', [i, i + 1, i + 2])
      .orderBy('u.id')
      .limit(25)
      .toSql();
  }),
);

results.push(
  measure('clone()', 20_000, () => {
    new QueryBuilder('users').where('active', '=', 1).orderBy('id').clone();
  }),
);

const insertN = 2_000;
results.push(
  await measureAsync('sqlite insert().make()', insertN, (i) =>
    new QueryBuilder('users').insert({ email: `u${i}@x.com`, active: i % 2 }).make(),
  ),
);

results.push(
  await measureAsync('sqlite where().all()', 2_000, (i) =>
    new QueryBuilder('users').where('id', '=', (i % insertN) + 1).all(),
  ),
);

const kit = createQueryKit(exec);
results.push(
  await measureAsync('createQueryKit table().all()', 2_000, (i) =>
    kit.table('users').where('id', '=', (i % insertN) + 1).all(),
  ),
);

exec.close();

const node = process.version;
const betterSqlite = createRequire(import.meta.url)('better-sqlite3/package.json').version;
const out = { node, betterSqlite3: betterSqlite, results };
console.log(JSON.stringify(out, null, 2));
