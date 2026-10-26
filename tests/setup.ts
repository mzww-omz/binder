import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env { DB: D1Database; TEST_MIGRATIONS: D1Migration[] }
    interface GlobalProps { mainModule: typeof import('../src/worker') }
  }
}

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await env.DB.prepare('DELETE FROM binders').run(); });
