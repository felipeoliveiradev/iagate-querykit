import { defineConfig } from 'tsup';

const entry = {
  index: 'src/index.ts',
  config: 'src/config.ts',
  raw: 'src/raw.ts',
  scheduler: 'src/scheduler.ts',
  'event-manager': 'src/event-manager.ts',
  'simulation-manager': 'src/simulation-manager.ts',
  'trigger-manager': 'src/trigger-manager.ts',
  'view-manager': 'src/view-manager.ts',
  'parallel-query': 'src/parallel-query.ts',
  'database-adapters/base-adapter': 'src/database-adapters/base-adapter.ts',
  'database-manager': 'src/database-manager.ts',
  querykit: 'src/querykit.ts',
  'query-builder': 'src/query-builder.ts',
  model: 'src/model.ts',
  table: 'src/table.ts',
  types: 'src/types.ts',
  seed: 'src/seed.ts',
  'migration-manager': 'src/migration-manager.ts',
  'migration-dsl': 'src/migration-dsl.ts',
  'relations-resolver': 'src/relations-resolver.ts',
  'adapters/index': 'src/adapters/index.ts',
  'adapters/better-sqlite3': 'src/adapters/better-sqlite3.ts',
  'adapters/mysql': 'src/adapters/mysql.ts',
  'adapters/postgresql': 'src/adapters/postgresql.ts',
  'adapters/oracle': 'src/adapters/oracle.ts',
  'adapters/sqlserver': 'src/adapters/sqlserver.ts',
};

export default defineConfig({
  entry,
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  target: 'node18',
  tsconfig: 'tsconfig.json',
  outExtension({ format }) {
    return format === 'cjs' ? { js: '.cjs' } : { js: '.js' };
  },
});
