import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: {
      TEST_MIGRATIONS: await readD1Migrations('./migrations'),
      IP_RATE_LIMIT_SECRET: 'test-only-daily-limit-secret-at-least-32-characters',
    } },
  })],
  test: { setupFiles: ['./tests/setup.ts'] },
});
