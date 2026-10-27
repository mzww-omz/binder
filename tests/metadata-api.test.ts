import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import worker from '../src/worker';

const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,16,0,0,0,16]);
function outbound(page: () => Promise<Response> = async () => new Response('<title> Page &amp; title </title><link rel="icon" href="/icon.png">', { headers: { 'Content-Type': 'text/html' } })) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: 0, Answer: url.includes('type=AAAA') ? [] : [{ type: 1, data: '93.184.216.34' }] });
    if (url === 'https://site.com/icon.png') return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    return url === 'https://site.com/' ? page() : new Response(null, { status: 404 });
  });
}
async function request(path: string, method = 'GET', body?: unknown, token?: string) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://binder.test/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env as never, ctx);
  return { response, ctx };
}
async function binder() {
  const { response } = await request('/binders', 'POST', {});
  return await response.json() as { id: string; edit_token: string; expires_at: number };
}
async function add(b: Awaited<ReturnType<typeof binder>>, title?: string) {
  const result = await request(`/binders/${b.id}/nodes`, 'POST', { type: 'link', url: 'https://site.com/', ...(title === undefined ? {} : { title }) }, b.edit_token);
  expect(result.response.status).toBe(201);
  const node = await result.response.json() as { id: string; title: string; metadata_status: string; favicon_url: string | null };
  return { ...result, node };
}
async function get(binderId: string, nodeId: string) {
  const { response } = await request(`/binders/${binderId}`);
  expect(response.status).toBe(200);
  const data = await response.json() as { nodes: { id: string; title: string; metadata_status: string; favicon_url: string | null; url: string }[] };
  return data.nodes.find(node => node.id === nodeId)!;
}

test('creates immediately with hostname, then enriches through waitUntil and serves only stored icons', async () => {
  let release!: (response: Response) => void;
  const page = new Promise<Response>(resolve => { release = resolve; });
  const fetch = outbound(() => page);
  const b = await binder(), { node, ctx } = await add(b);
  expect(node).toMatchObject({ title: 'site.com', metadata_status: 'pending', favicon_url: null });
  release(new Response('<title>Page &amp; title</title><link rel="icon" href="/icon.png">', { headers: { 'Content-Type': 'text/html' } }));
  await waitOnExecutionContext(ctx);
  const enriched = await get(b.id, node.id);
  expect(enriched).toMatchObject({ title: 'Page & title', metadata_status: 'ready' });
  expect(enriched.favicon_url).toMatch(new RegExp(`^/api/binders/${b.id}/nodes/${node.id}/favicon\\?v=1$`));
  const count = fetch.mock.calls.length;
  const { response: icon } = await request(enriched.favicon_url!.replace('/api', ''));
  expect(icon.status).toBe(200); expect(icon.headers.get('Content-Type')).toBe('image/png');
  expect(new Uint8Array(await icon.arrayBuffer())).toEqual(png);
  expect(icon.headers.get('Cache-Control')).toContain('private, max-age=');
  expect(icon.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  expect(fetch.mock.calls).toHaveLength(count);
  const { response: read } = await request(`/binders/${b.id}`);
  const json = await read.json() as { expires_at: number; nodes: object[] };
  expect(json.expires_at).toBe(b.expires_at);
  expect(JSON.stringify(json)).not.toContain('title_is_manual');
  expect(JSON.stringify(json)).not.toContain('favicon_type');
  expect(await env.DB.prepare('SELECT metadata_requests FROM binders WHERE id = ?').bind(b.id).first('metadata_requests')).toBe(1);
});

test('preserves supplied titles and manual renames even while metadata is in flight', async () => {
  outbound(); const b = await binder(), manual = await add(b, 'Manual title');
  await waitOnExecutionContext(manual.ctx); expect((await get(b.id, manual.node.id)).title).toBe('Manual title');
  let release!: (response: Response) => void;
  outbound(() => new Promise(resolve => { release = resolve; }));
  const pending = await add(b);
  // Wait until the controlled external request has started, without resolving it.
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const rename = await request(`/binders/${b.id}/nodes/${pending.node.id}`, 'PATCH', { title: 'site.com' }, b.edit_token);
  expect(rename.response.status).toBe(200); await waitOnExecutionContext(rename.ctx);
  release(new Response('<title>Must not overwrite</title>', { headers: { 'Content-Type': 'text/html' } }));
  await waitOnExecutionContext(pending.ctx);
  expect((await get(b.id, pending.node.id)).title).toBe('site.com');
});

test('failed enrichment still saves a link and old rows retain manual titles and generic icons', async () => {
  const b = await binder(), result = await add(b);
  await waitOnExecutionContext(result.ctx);
  expect(await get(b.id, result.node.id)).toMatchObject({ title: 'site.com', metadata_status: 'failed', favicon_url: null });
  const now = Date.now();
  await env.DB.prepare("INSERT INTO nodes (id,binder_id,parent_id,type,title,url,sort_order,created_at,updated_at) VALUES (?, ?, NULL, 'link', ?, ?, 0, ?, ?)")
    .bind('a'.repeat(32), b.id, 'Existing title', 'https://old.com/', now, now).run();
  expect(await get(b.id, 'a'.repeat(32))).toMatchObject({ title: 'Existing title', metadata_status: 'none', favicon_url: null });
});

test('late jobs cannot revive deleted/expired nodes; favicon access respects expiry', async () => {
  outbound(); const b = await binder(), result = await add(b); await waitOnExecutionContext(result.ctx);
  let release!: (response: Response) => void;
  outbound(() => new Promise(resolve => { release = resolve; }));
  const pending = await add(b);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const now = Date.now();
  await env.DB.prepare('UPDATE binders SET created_at=?, expires_at=? WHERE id=?').bind(now - 604800000, now, b.id).run();
  release(new Response('<title>Expired result</title>', { headers: { 'Content-Type': 'text/html' } }));
  await waitOnExecutionContext(pending.ctx);
  expect(await env.DB.prepare('SELECT title, favicon FROM nodes WHERE id=?').bind(pending.node.id).first()).toEqual({ title: 'site.com', favicon: null });
  expect((await request(`/binders/${b.id}/nodes/${result.node.id}/favicon`)).response.status).toBe(404);
  expect((await request(`/binders/${b.id}`)).response.status).toBe(404);
});

test('ignores stale URL jobs and does not revive a deleted node', async () => {
  let release!: (response: Response) => void;
  const old = new Promise<Response>(resolve => { release = resolve; });
  const fetch = outbound(() => old);
  const b = await binder(), pending = await add(b);
  await vi.waitFor(() => expect(fetch.mock.calls.some(([input]) => String(input) === 'https://site.com/')).toBe(true));
  const changed = await request(`/binders/${b.id}/nodes/${pending.node.id}`, 'PATCH', { title: 'Manual replacement', url: 'https://newsite.com/' }, b.edit_token);
  expect(changed.response.status).toBe(200); await waitOnExecutionContext(changed.ctx);
  release(new Response('<title>Stale title</title><link rel="icon" href="/icon.png">', { headers: { 'Content-Type': 'text/html' } }));
  await waitOnExecutionContext(pending.ctx);
  expect(await get(b.id, pending.node.id)).toMatchObject({ title: 'Manual replacement', url: 'https://newsite.com/', favicon_url: null });
  let finish!: (response: Response) => void;
  outbound(() => new Promise(resolve => { finish = resolve; }));
  const deleted = await add(b);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect((await request(`/binders/${b.id}/nodes/${deleted.node.id}`, 'DELETE', undefined, b.edit_token)).response.status).toBe(204);
  finish(new Response('<title>Deleted</title>', { headers: { 'Content-Type': 'text/html' } }));
  await waitOnExecutionContext(deleted.ctx);
  expect(await env.DB.prepare('SELECT id FROM nodes WHERE id=?').bind(deleted.node.id).first()).toBeNull();
});

test('concurrent metadata reservations cannot exceed the per-Binder budget', async () => {
  const fetch = outbound(), b = await binder();
  await env.DB.prepare('UPDATE binders SET metadata_requests=399 WHERE id=?').bind(b.id).run();
  const nodes = await Promise.all([add(b), add(b)]);
  await Promise.all(nodes.map(node => waitOnExecutionContext(node.ctx)));
  expect(await env.DB.prepare('SELECT metadata_requests FROM binders WHERE id=?').bind(b.id).first('metadata_requests')).toBe(400);
  expect(fetch.mock.calls.filter(([input]) => String(input) === 'https://site.com/')).toHaveLength(1);
  expect((await Promise.all(nodes.map(node => get(b.id, node.node.id)))).map(node => node.metadata_status).sort()).toEqual(['failed', 'ready']);
});

test('bounds per-Binder outbound jobs, without preventing link creation after the budget is exhausted', async () => {
  const fetch = outbound(), b = await binder();
  await env.DB.prepare('UPDATE binders SET metadata_requests=400 WHERE id=?').bind(b.id).run();
  const result = await add(b); await waitOnExecutionContext(result.ctx);
  expect(await get(b.id, result.node.id)).toMatchObject({ title: 'site.com', metadata_status: 'failed', favicon_url: null });
  expect(fetch).not.toHaveBeenCalled();
});
