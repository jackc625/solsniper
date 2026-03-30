import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env for tests so env.ts validation passes
// Tests that need to test env loading should mock the env module directly
config();

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    env: {
      // Override NODE_ENV to development so env.ts validation passes during tests
      NODE_ENV: 'development',
    },
  },
});
