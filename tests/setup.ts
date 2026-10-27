import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, vi } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env { DB: D1Database; TEST_MIGRATIONS: D1Migration[]; IP_RATE_LIMIT_SECRET: string }
    interface GlobalProps { mainModule: typeof import('../src/worker') }
  }
}

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM binders'),
    env.DB.prepare('DELETE FROM binder_creation_limits'),
  ]);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External requests disabled in tests'));
});
afterEach(() => vi.restoreAllMocks());
