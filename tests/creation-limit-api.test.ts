import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import worker from '../src/worker';
import { creationBucket } from '../src/creation-limit';

async function create(ip: string | null = '203.0.113.10', extraHeaders: Record<string, string> = {}, overrides = {}) {
  const ctx = createExecutionContext();
  return await worker.fetch(new Request('https://binder.test/api/binders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...extraHeaders }, body: '{}',
  }), { ...env, ...overrides } as never, ctx);
}

test('allows exactly 50 creations, deletion does not refund quota, and forwarded headers cannot bypass it', async () => {
  for (let i = 0; i < 50; i++) {
    const response = await create(); expect(response.status).toBe(201);
    const binder = await response.json() as { id: string; edit_token: string };
    const deleted = await worker.fetch(new Request(`https://binder.test/api/binders/${binder.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${binder.edit_token}` },
    }), env as never, createExecutionContext());
    expect(deleted.status).toBe(204);
  }
  const denied = await create('203.0.113.10', { 'X-Forwarded-For': '198.51.100.99', 'X-Real-IP': '198.51.100.99' });
  expect(denied.status).toBe(429);
  expect(await denied.json()).toEqual({ error: 'Daily Binder creation limit reached (50 per IP).' });
  expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(denied.headers.get('Cache-Control')).toBe('no-store');
  const rows = await env.DB.prepare('SELECT * FROM binder_creation_limits').all();
  expect(rows.results).toHaveLength(1); expect(rows.results[0].created_count).toBe(50);
  expect(JSON.stringify(rows.results)).not.toContain('203.0.113.10');
  expect((await create('203.0.113.11')).status).toBe(201);
});

test('concurrent attempts reserve only the last available slot and do not leave orphan counters or Binders', async () => {
  const bucket = (await creationBucket('203.0.113.10', env.IP_RATE_LIMIT_SECRET, Date.now()))!;
  await env.DB.prepare('INSERT INTO binder_creation_limits VALUES (?, ?, 49)').bind(bucket.hash, bucket.resetAt).run();
  const responses = await Promise.all(Array.from({ length: 4 }, () => create()));
  expect(responses.map(response => response.status).sort()).toEqual([201, 429, 429, 429]);
  expect(await env.DB.prepare('SELECT created_count FROM binder_creation_limits').first('created_count')).toBe(50);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM binders').first('n')).toBe(1);
});

test('failed creation due to the existing global capacity does not consume the IP quota', async () => {
  for (let i = 0; i < 20; i++) expect((await create()).status).toBe(201);
  expect((await create()).status).toBe(429);
  expect((await create('203.0.113.99')).status).toBe(429);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM binder_creation_limits').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT created_count FROM binder_creation_limits').first('created_count')).toBe(20);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM binders').first('n')).toBe(20);
});

test('a full daily quota resets precisely at midnight JST', async () => {
  const midnight = Date.parse('2026-10-26T15:00:00Z');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(midnight - 1);
  const bucket = (await creationBucket('203.0.113.10', env.IP_RATE_LIMIT_SECRET, Date.now()))!;
  await env.DB.prepare('INSERT INTO binder_creation_limits VALUES (?, ?, 50)').bind(bucket.hash, bucket.resetAt).run();
  const denied = await create(); expect(denied.status).toBe(429); expect(denied.headers.get('Retry-After')).toBe('1');
  clock.mockReturnValue(midnight);
  expect((await create()).status).toBe(201);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM binder_creation_limits').first('n')).toBe(2);
});

test.each([null, 'invalid'])('fails closed without a valid trusted client IP: %s', async ip => {
  expect((await create(ip, { 'X-Forwarded-For': '203.0.113.10' })).status).toBe(503);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM binders').first('n')).toBe(0);
});

test('fails closed without the secret rather than accepting unlimited creations', async () => {
  expect((await create('203.0.113.10', {}, { IP_RATE_LIMIT_SECRET: '' })).status).toBe(503);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM binder_creation_limits').first('n')).toBe(0);
});

test('Cron removes old buckets but retains yesterday to protect requests crossing midnight', async () => {
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO binder_creation_limits VALUES (?, ?, 1)').bind('a'.repeat(64), now - 86400000),
    env.DB.prepare('INSERT INTO binder_creation_limits VALUES (?, ?, 1)').bind('b'.repeat(64), now - 86400000 + 1),
    env.DB.prepare('INSERT INTO binder_creation_limits VALUES (?, ?, 1)').bind('c'.repeat(64), now + 3600000),
  ]);
  const ctx = createExecutionContext(); await worker.scheduled(createScheduledController(), env as never, ctx); await waitOnExecutionContext(ctx);
  expect((await env.DB.prepare('SELECT ip_day_hash FROM binder_creation_limits ORDER BY ip_day_hash').all()).results)
    .toEqual([{ ip_day_hash: 'b'.repeat(64) }, { ip_day_hash: 'c'.repeat(64) }]);
});
