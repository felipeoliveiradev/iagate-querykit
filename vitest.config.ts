import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    env: {
      POSTGRES_HOST: process.env.POSTGRES_HOST || '127.0.0.1',
      POSTGRES_PORT: process.env.POSTGRES_PORT || '5432',
      POSTGRES_USER: process.env.POSTGRES_USER || 'querykit',
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'querykit',
      POSTGRES_DB: process.env.POSTGRES_DB || 'querykit',
      MYSQL_HOST: process.env.MYSQL_HOST || '127.0.0.1',
      MYSQL_PORT: process.env.MYSQL_PORT || '3306',
      MYSQL_USER: process.env.MYSQL_USER || 'querykit',
      MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'querykit',
      MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'querykit',
    },
    coverage: {
      enabled: false,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/index.ts'],
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
