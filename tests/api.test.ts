import { env, exports } from 'cloudflare:workers';
import { expect, test, vi } from 'vitest';
import { createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/worker';

const request = (path: string, method = 'GET', body?: unknown, token?: string) =>
  exports.default.fetch(`https://binder.test/api${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function create() {
  const res = await request('/binders', 'POST', {});
  expect(res.status).toBe(201);
  return await res.json() as { id: string; edit_token: string; created_at: number; expires_at: number };
}

test('creates a Binder with a hashed secret and exactly 168 hours, exposes no secret on read', async () => {
  const b = await create();
  expect(b.id).toMatch(/^[a-f0-9]{32}$/);
  expect(b.edit_token).toMatch(/^[a-f0-9]{64}$/);
  expect(b.expires_at - b.created_at).toBe(604800000);
  const stored = await env.DB.prepare('SELECT edit_token_hash FROM binders WHERE id = ?').bind(b.id).first();
  expect(stored?.edit_token_hash).toHaveLength(64);
  expect(stored?.edit_token_hash).not.toBe(b.edit_token);
  const read = await request(`/binders/${b.id}`);
  expect(read.status).toBe(200);
  const json = await read.json() as Record<string, unknown>;
  expect(json.nodes).toEqual([]);
  expect(JSON.stringify(json)).not.toContain('edit_token');
  expect(read.headers.get('Cache-Control')).toBe('no-store');
});

async function add(b: Awaited<ReturnType<typeof create>>, type = 'folder', parent_id: string | null = null, name = 'Research') {
  const res = await request(`/binders/${b.id}/nodes`, 'POST', {
    type, title: name, parent_id, ...(type === 'link' ? { url: 'https://example.com/' } : {}),
  }, b.edit_token);
  expect(res.status).toBe(201);
  return await res.json() as { id: string };
}
async function read(id: string) {
  return await (await request(`/binders/${id}`)).json() as { nodes: { id: string; title: string; url: string; parent_id: string | null }[]; expires_at: number };
}

test('creates nested folders and root links; renames and edits links without extending expiry', async () => {
  const b = await create();
  const a = await add(b), child = await add(b, 'folder', a.id), deep = await add(b, 'folder', child.id);
  await add(b, 'link', deep.id);
  const link = await add(b, 'link');
  expect((await request(`/binders/${b.id}/nodes/${link.id}`, 'PATCH', { title: 'Docs', url: 'https://example.org/docs' }, b.edit_token)).status).toBe(200);
  const data = await read(b.id);
  expect(data.nodes).toHaveLength(5);
  expect(data.nodes.find(n => n.id === link.id)).toMatchObject({ title: 'Docs', url: 'https://example.org/docs', parent_id: null });
  expect(data.expires_at).toBe(b.expires_at);
});

test('moves folders and links, rejects self/descendant/link/cross-Binder parents', async () => {
  const b = await create(), other = await create();
  const a = await add(b), child = await add(b, 'folder', a.id), destination = await add(b), link = await add(b, 'link'), foreign = await add(other);
  const move = (id: string, parent_id: string | null) => request(`/binders/${b.id}/nodes/${id}`, 'PATCH', { parent_id }, b.edit_token);
  expect((await move(a.id, a.id)).status).toBe(400);
  expect((await move(a.id, child.id)).status).toBe(400);
  expect((await move(a.id, link.id)).status).toBe(400);
  expect((await move(a.id, foreign.id)).status).toBe(400);
  expect((await move(a.id, destination.id)).status).toBe(200);
  expect((await move(link.id, child.id)).status).toBe(200);
  expect((await move(child.id, null)).status).toBe(200);
  expect((await read(b.id)).nodes.find(n => n.id === a.id)?.parent_id).toBe(destination.id);
});

test('deletes a link, a complete folder subtree, and a Binder atomically', async () => {
  const b = await create(), a = await add(b), child = await add(b, 'folder', a.id);
  await add(b, 'link', child.id);
  const root = await add(b, 'link');
  expect((await request(`/binders/${b.id}/nodes/${a.id}`, 'DELETE', undefined, b.edit_token)).status).toBe(204);
  expect((await read(b.id)).nodes.map(n => n.id)).toEqual([root.id]);
  expect((await request(`/binders/${b.id}/nodes/${root.id}`, 'DELETE', undefined, b.edit_token)).status).toBe(204);
  await add(b);
  expect((await request(`/binders/${b.id}`, 'DELETE', undefined, b.edit_token)).status).toBe(204);
  expect((await request(`/binders/${b.id}`)).status).toBe(404);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM nodes').first())?.n).toBe(0);
});

test('every mutation and edit access check require the correct token; public URL cannot mutate', async () => {
  const b = await create(), n = await add(b);
  const operations: [string, string, unknown?][] = [
    [`/binders/${b.id}`, 'DELETE'],
    [`/binders/${b.id}/nodes`, 'POST', { type: 'folder', title: 'Denied' }],
    [`/binders/${b.id}/nodes/${n.id}`, 'PATCH', { title: 'Denied' }],
    [`/binders/${b.id}/nodes/${n.id}`, 'DELETE'],
    [`/binders/${b.id}/reorder`, 'PUT', { parent_id: null, ids: [n.id] }],
    [`/binders/${b.id}/access`, 'GET'],
  ];
  for (const [path, method, body] of operations) {
    for (const token of [undefined, '0'.repeat(64)]) expect((await request(path, method, body, token)).status).toBe(401);
  }
  expect((await request(`/binders/${b.id}/access`, 'GET', undefined, b.edit_token)).status).toBe(200);
  expect((await read(b.id)).nodes[0].title).toBe('Research');
});

test('reorders siblings and rejects duplicate, missing, foreign, or nested IDs without partial writes', async () => {
  const b = await create(), a = await add(b), c = await add(b), child = await add(b, 'folder', a.id);
  const reorder = (ids: string[]) => request(`/binders/${b.id}/reorder`, 'PUT', { parent_id: null, ids }, b.edit_token);
  expect((await reorder([c.id, a.id])).status).toBe(200);
  expect((await read(b.id)).nodes.filter(n => !n.parent_id).map(n => n.id)).toEqual([c.id, a.id]);
  for (const ids of [[a.id, a.id], [a.id], [a.id, child.id], [a.id, 'f'.repeat(32)]]) expect((await reorder(ids)).status).toBe(409);
  expect((await read(b.id)).nodes.filter(n => !n.parent_id).map(n => n.id)).toEqual([c.id, a.id]);
});

test('expiry is exclusive at the exact millisecond, forbids read and every edit, Cron removes only expired trees', async () => {
  const b = await create();
  await add(b);
  const now = Date.now();
  await env.DB.prepare('UPDATE binders SET created_at = ?, expires_at = ? WHERE id = ?').bind(now - 604800000, now, b.id).run();
  expect((await request(`/binders/${b.id}`)).status).toBe(404);
  expect((await request(`/binders/${b.id}`, 'DELETE', undefined, b.edit_token)).status).toBe(404);
  expect((await request(`/binders/${b.id}/nodes`, 'POST', { type: 'folder', title: 'Late' }, b.edit_token)).status).toBe(404);
  const node = (await env.DB.prepare('SELECT id FROM nodes WHERE binder_id = ?').bind(b.id).first<{ id: string }>())!;
  expect((await request(`/binders/${b.id}/nodes/${node.id}`, 'PATCH', { title: 'Late' }, b.edit_token)).status).toBe(404);
  expect((await request(`/binders/${b.id}/nodes/${node.id}`, 'DELETE', undefined, b.edit_token)).status).toBe(404);
  expect((await request(`/binders/${b.id}/reorder`, 'PUT', { parent_id: null, ids: [node.id] }, b.edit_token)).status).toBe(404);
  const live = await create();
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController(), env as never, ctx);
  await waitOnExecutionContext(ctx);
  expect(await env.DB.prepare('SELECT id FROM binders WHERE id = ?').bind(b.id).first()).toBeNull();
  expect((await env.DB.prepare('SELECT count(*) AS n FROM nodes').first())?.n).toBe(0);
  expect((await request(`/binders/${live.id}`)).status).toBe(200);
});

test('returns 200 just before expiry and 404 exactly at expiry independently of Cron', async () => {
  const b = await create();
  vi.spyOn(Date, 'now').mockReturnValue(b.expires_at - 1);
  try {
    expect((await request(`/binders/${b.id}`)).status).toBe(200);
    vi.mocked(Date.now).mockReturnValue(b.expires_at);
    expect((await request(`/binders/${b.id}`)).status).toBe(404);
    expect((await request(`/binders/${b.id}/access`, 'GET', undefined, b.edit_token)).status).toBe(404);
  } finally { vi.restoreAllMocks(); }
});

test.each(['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//example.com', 'https://a:b@example.com', 'https://exa mple.com', 'https://example.com/\n'])('rejects unsafe URL %s', async value => {
  const b = await create();
  expect((await request(`/binders/${b.id}/nodes`, 'POST', { type: 'link', title: 'Bad', url: value }, b.edit_token)).status).toBe(400);
});

test('handles hostile titles as data, validates input lengths, unknown fields and request size', async () => {
  const b = await create();
  const n = await add(b, 'link', null, '<img src=x onerror=alert(1)>');
  expect((await read(b.id)).nodes[0].title).toBe('<img src=x onerror=alert(1)>');
  const patch = (body: unknown) => request(`/binders/${b.id}/nodes/${n.id}`, 'PATCH', body, b.edit_token);
  for (const body of [{ title: '' }, { title: 'x'.repeat(201) }, { expires_at: Date.now() }, { type: 'folder' }, { url: 'x'.repeat(2049) }]) expect((await patch(body)).status).toBe(400);
  expect((await patch({ title: 'x'.repeat(17000) })).status).toBe(413);
  const wrongOrigin = await exports.default.fetch('https://binder.test/api/binders', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' });
  expect(wrongOrigin.status).toBe(403);
  const raw = await exports.default.fetch('https://binder.test/api/binders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  expect(raw.status).toBe(400);
  expect((await request('/binders', 'POST')).status).toBe(415);
});

test('guards deletion at SQL execution time even when expiry follows request-time validation', async () => {
  const b = await create(), node = await add(b);
  const expires = Date.now() - 1;
  await env.DB.prepare('UPDATE binders SET created_at = ?, expires_at = ? WHERE id = ?').bind(expires - 604800000, expires, b.id).run();
  vi.spyOn(Date, 'now').mockReturnValue(expires - 100);
  try {
    expect((await request(`/binders/${b.id}/nodes/${node.id}`, 'DELETE', undefined, b.edit_token)).status).toBe(404);
    expect((await request(`/binders/${b.id}`, 'DELETE', undefined, b.edit_token)).status).toBe(404);
    expect(await env.DB.prepare('SELECT id FROM nodes WHERE id = ?').bind(node.id).first()).not.toBeNull();
  } finally { vi.restoreAllMocks(); }
});

test('database constraints reject a link with a null URL', async () => {
  const b = await create(), now = Date.now();
  await expect(env.DB.prepare("INSERT INTO nodes VALUES (?, ?, NULL, 'link', 'Invalid', NULL, 0, ?, ?)")
    .bind('a'.repeat(32), b.id, now, now).run()).rejects.toThrow();
});

test('a valid token from another Binder cannot change or delete this Binder’s nodes', async () => {
  const b = await create(), other = await create(), node = await add(b);
  expect((await request(`/binders/${b.id}/nodes/${node.id}`, 'DELETE', undefined, other.edit_token)).status).toBe(401);
  expect((await request(`/binders/${other.id}/nodes/${node.id}`, 'PATCH', { title: 'Denied' }, other.edit_token)).status).toBe(404);
  expect((await request(`/binders/${other.id}/nodes/${node.id}`, 'DELETE', undefined, other.edit_token)).status).toBe(404);
});

test('enforces node and anonymous creation capacity, including concurrent inserts', async () => {
  const b = await create();
  const now = Date.now();
  await env.DB.batch(Array.from({ length: 199 }, (_, i) => env.DB.prepare("INSERT INTO nodes VALUES (?, ?, NULL, 'folder', 'Fixture', NULL, ?, ?, ?)").bind(i.toString(16).padStart(32, '0'), b.id, i, now, now)));
  const results = await Promise.all([1, 2].map(() => request(`/binders/${b.id}/nodes`, 'POST', { type: 'folder', title: 'Last' }, b.edit_token)));
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  for (let i = 0; i < 19; i++) await create();
  expect((await request('/binders', 'POST', {})).status).toBe(429);
});
