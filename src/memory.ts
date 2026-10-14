/**
 * Example adapter module. Pair `memoryDialect` with BetterSqlite3Executor(':memory:')
 * or any executor that understands SQLite SQL. Proves a new DB can be plugged in
 * without editing core files — see ADDING_A_DATABASE.md.
 */
import './dialects/memory/index.js';
export { memoryDialect } from './dialects/memory/index.js';
export { createQueryKit } from './querykit.js';
export { QueryBuilder } from './query-builder.js';
export { registerDialect } from './engine/registry.js';
