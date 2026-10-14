import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      enabled: false,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/index.ts',
        'src/types.ts',
        'src/sqlite.ts',
        'src/postgres.ts',
        'src/mysql.ts',
        'src/oracle.ts',
        'src/mssql.ts',
        'src/memory.ts',
        'src/engine/dialect.ts',
        'src/engine/conformance.ts',
      ],
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
