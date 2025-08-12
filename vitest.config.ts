// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: true, // Ensure coverage is enabled
      exclude: [
        'website/**', // Excludes all files within the 'src/utils' folder
        'node_modules/**',
        'dist/**',
        'vite.config.ts',
        'covarage/**', // Excludes all files directly within 'src/mock-data'
      ],
    },
  },
});