import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { Binder, BinderNode } from './types';
import { enrichNode } from './enrichment';

type Bindings = { DB: D1Database; ASSETS: Fetcher };
type Variables = { binder: Binder & { edit_token_hash: string } };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const columns = 'id, title, created_at, expires_at, updated_at';
const nodeColumns = `id, binder_id, parent_id, type, title, url, sort_order, created_at, updated_at, metadata_status,
  CASE WHEN favicon IS NULL THEN NULL ELSE '/api/binders/' || binder_id || '/nodes/' || id || '/favicon?v=' || metadata_version END AS favicon_url`;
function fail(status: 400 | 401 | 404 | 409 | 413 | 415 | 429, message: string): never {
  throw new HTTPException(status, { message });
}
const random = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
async function hash(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

app.use('/api/binders/:id/nodes/:nodeId/favicon', async (c, next) => {
  await next();
  // Run after secureHeaders so SVG documents remain sandboxed, including direct navigation.
  c.header('Content-Security-Policy', "default-src 'none'; sandbox");
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
});
app.use('*', secureHeaders({
  referrerPolicy: 'no-referrer',
  contentSecurityPolicy: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
    imgSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"],
    frameAncestors: ["'none'"], formAction: ["'self'"] },
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
}));
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const origin = c.req.header('Origin');
  if (c.req.method !== 'GET' && origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: 'Cross-origin request denied' }, 403);
  }
  await next();
});
app.use('/api/*', bodyLimit({ maxSize: 16384, onError: c => c.json({ error: 'Request too large' }, 413) }));

async function json(c: Context): Promise<Record<string, unknown>> {
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'Expected application/json');
  let value: unknown;
  try { value = await c.req.json(); } catch { fail(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected an object');
  return value as Record<string, unknown>;
}
function fields(data: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(data).some(key => !allowed.includes(key))) fail(400, 'Unknown field');
}
function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail(400, 'Name must be 1–200 characters');
  return value.trim();
}
function url(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) fail(400, 'Invalid URL');
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) fail(400, 'Use an http or https URL without credentials');
    if (parsed.href.length > 2048) fail(400, 'URL too long');
    return parsed.href;
  } catch { return fail(400, 'Use an http or https URL without credentials'); }
}
function parent(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) fail(400, 'Invalid parent');
  return value;
}

app.post('/api/binders', async c => {
  const data = await json(c);
  fields(data, ['title']);
  const name = data.title === undefined ? 'Binder' : title(data.title);
  const id = random(16), token = random(32), now = Date.now();
  const expires = now + 604800000;
  await c.env.DB.prepare('INSERT INTO binders (id, title, edit_token_hash, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, await hash(token), now, expires, now).run();
  return c.json({ id, title: name, edit_token: token, created_at: now, expires_at: expires, updated_at: now }, 201);
});
app.use('/api/binders/:id/*', async (c, next) => {
  const binder = await c.env.DB.prepare('SELECT * FROM binders WHERE id = ? AND expires_at > ?')
    .bind(c.req.param('id'), Date.now()).first<Variables['binder']>();
  if (!binder) fail(404, 'Binder not found or expired');
  c.set('binder', binder);
  if (c.req.method !== 'GET' || c.req.path.endsWith('/access')) {
    const authorization = c.req.header('Authorization') ?? '';
    if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) fail(401, 'Edit URL required');
    const actual = await hash(authorization.slice(7));
    // Compare every byte; never log Authorization, request bodies, or secret URLs.
    let difference = 0;
    for (let i = 0; i < 64; i++) difference |= actual.charCodeAt(i) ^ binder.edit_token_hash.charCodeAt(i);
    if (difference) fail(401, 'Invalid edit token');
  }
  if (binder.expires_at <= Date.now()) fail(404, 'Binder not found or expired');
  await next();
});
app.get('/api/binders/:id', async c => {
  const id = c.get('binder').id;
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT ${columns} FROM binders WHERE id = ? AND expires_at > ?`).bind(id, Date.now()),
    c.env.DB.prepare(`SELECT ${nodeColumns} FROM nodes WHERE binder_id = ? ORDER BY sort_order, id`).bind(id),
  ]);
  const binder = result[0].results[0] as unknown as Binder | undefined;
  if (!binder || binder.expires_at <= Date.now()) fail(404, 'Binder not found or expired');
  return c.json({ ...binder, nodes: result[1].results as unknown as BinderNode[] });
});
app.get('/api/binders/:id/access', c => c.json({ editable: true }));
app.get('/api/binders/:id/nodes/:nodeId/favicon', async c => {
  const row = await c.env.DB.prepare('SELECT favicon, favicon_type FROM nodes WHERE id = ? AND binder_id = ?')
    .bind(c.req.param('nodeId'), c.get('binder').id).first<{ favicon: number[] | null; favicon_type: string | null }>();
  const remaining = Math.floor((c.get('binder').expires_at - Date.now()) / 1000);
  if (!row?.favicon || !row.favicon_type || remaining <= 0) fail(404, 'Item not found');
  c.header('Content-Type', row.favicon_type);
  c.header('Cache-Control', `private, max-age=${Math.min(3600, remaining)}`);
  return c.body(Uint8Array.from(row.favicon));
});

app.delete('/api/binders/:id', async c => {
  const result = await c.env.DB.prepare("DELETE FROM binders WHERE id = ? AND expires_at > max(?, unixepoch('subsec') * 1000) RETURNING id")
    .bind(c.get('binder').id, Date.now()).all();
  if (!result.results.length) fail(404, 'Binder not found or expired');
  return c.body(null, 204);
});
app.post('/api/binders/:id/nodes', async c => {
  const data = await json(c);
  fields(data, ['type', 'title', 'url', 'parent_id']);
  if (data.type !== 'folder' && data.type !== 'link') fail(400, 'Choose folder or link');
  if (data.type === 'folder' && data.url !== undefined) fail(400, 'Folders cannot have a URL');
  const href = data.type === 'link' ? url(data.url) : null;
  const name = href && data.title === undefined ? new URL(href).hostname.slice(0, 200) : title(data.title);
  const parentId = parent(data.parent_id ?? null), binderId = c.get('binder').id, now = Date.now();
  const row = await c.env.DB.prepare(`INSERT INTO nodes
    (id, binder_id, parent_id, type, title, url, sort_order, created_at, updated_at, title_is_manual, metadata_status, metadata_version)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT coalesce(max(sort_order), -1) + 1 FROM nodes WHERE binder_id = ? AND parent_id IS ?), ?, ?, ?, ?, ?) RETURNING ${nodeColumns}`)
    .bind(random(16), binderId, parentId, data.type, name, href, binderId, parentId, now, now,
      data.title === undefined && href ? 0 : 1, href ? 'pending' : 'none', href ? 1 : 0).first<BinderNode>();
  if (href && row) c.executionCtx.waitUntil(enrichNode(c.env.DB, binderId, row.id, href, 1, new URL(c.req.url).origin));
  return c.json(row, 201);
});
app.patch('/api/binders/:id/nodes/:nodeId', async c => {
  const data = await json(c);
  fields(data, ['title', 'url', 'parent_id']);
  if (!Object.keys(data).length) fail(400, 'No changes supplied');
  const binderId = c.get('binder').id, nodeId = c.req.param('nodeId');
  const sets: string[] = [], values: (string | number | null)[] = [];
  let changedUrl: string | null = null;
  if ('title' in data) { sets.push('title = ?', 'title_is_manual = 1'); values.push(title(data.title)); }
  if ('url' in data) {
    const node = await c.env.DB.prepare('SELECT type, url FROM nodes WHERE id = ? AND binder_id = ?').bind(nodeId, binderId).first();
    if (!node) fail(404, 'Item not found');
    if (node.type !== 'link') fail(400, 'Folders cannot have a URL');
    const href = url(data.url);
    sets.push('url = ?'); values.push(href);
    if (href !== node.url) {
      changedUrl = href;
      sets.push("metadata_status = 'pending'", 'metadata_version = metadata_version + 1', 'favicon = NULL', 'favicon_type = NULL', 'title_is_manual = 1');
    }
  }
  if ('parent_id' in data) {
    const parentId = parent(data.parent_id);
    sets.push('parent_id = ?', 'sort_order = (SELECT coalesce(max(sort_order), -1) + 1 FROM nodes WHERE binder_id = ? AND parent_id IS ?)');
    values.push(parentId, binderId, parentId);
  }
  sets.push('updated_at = ?'); values.push(Date.now(), nodeId, binderId);
  const row = await c.env.DB.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ? AND binder_id = ? RETURNING ${nodeColumns}, metadata_version`)
    .bind(...values).first<BinderNode & { metadata_version: number }>();
  if (!row) fail(404, 'Item not found');
  const { metadata_version, ...node } = row;
  if (changedUrl) c.executionCtx.waitUntil(enrichNode(c.env.DB, binderId, nodeId, changedUrl, metadata_version, new URL(c.req.url).origin));
  return c.json(node);
});
app.delete('/api/binders/:id/nodes/:nodeId', async c => {
  const result = await c.env.DB.prepare(`DELETE FROM nodes WHERE id = ? AND binder_id = ?
    AND EXISTS (SELECT 1 FROM binders WHERE id = ? AND expires_at > max(?, unixepoch('subsec') * 1000)) RETURNING id`)
    .bind(c.req.param('nodeId'), c.get('binder').id, c.get('binder').id, Date.now()).all();
  if (!result.results.length) fail(404, 'Item not found or Binder expired');
  return c.body(null, 204);
});
app.put('/api/binders/:id/reorder', async c => {
  const data = await json(c);
  fields(data, ['parent_id', 'ids']);
  const parentId = parent(data.parent_id), binderId = c.get('binder').id;
  if (!Array.isArray(data.ids) || data.ids.length > 200 || data.ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) fail(400, 'Invalid order');
  if (new Set(data.ids).size !== data.ids.length) fail(409, 'Order must contain every sibling exactly once');
  if (!data.ids.length) {
    const count = await c.env.DB.prepare('SELECT count(*) AS n FROM nodes WHERE binder_id = ? AND parent_id IS ?').bind(binderId, parentId).first<{ n: number }>();
    if (count?.n) fail(409, 'Items changed. Reload and try again.');
    return c.json({ saved: true });
  }
  const ids = JSON.stringify(data.ids);
  // Validate membership and write the entire order in one statement to avoid races.
  const result = await c.env.DB.prepare(`UPDATE nodes SET
    sort_order = (SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value = nodes.id), updated_at = ?
    WHERE binder_id = ? AND parent_id IS ?
      AND (SELECT count(*) FROM nodes WHERE binder_id = ? AND parent_id IS ?) = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (
        SELECT 1 FROM nodes n WHERE n.id = j.value AND n.binder_id = ? AND n.parent_id IS ?))
    RETURNING id`).bind(ids, Date.now(), binderId, parentId, binderId, parentId, data.ids.length, ids, binderId, parentId).all();
  if (result.results.length !== data.ids.length) fail(409, 'Items changed. Reload and try again.');
  return c.json({ saved: true });
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  const message = error.message;
  if (/binder_capacity/.test(message)) return c.json({ error: 'Creation limit reached. Please try later.' }, 429);
  if (/node_capacity/.test(message)) return c.json({ error: 'A Binder can hold up to 200 items' }, 409);
  if (/binder_expired/.test(message)) return c.json({ error: 'Binder not found or expired' }, 404);
  if (/invalid_parent|invalid_node|folder_cycle|immutable_node|CHECK constraint/.test(message)) return c.json({ error: 'Invalid item or destination' }, 400);
  return c.json({ error: 'Unable to save. Please try again.' }, 500);
});
app.notFound(c => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, _ctx: ExecutionContext) {
    // Bound each invocation; API expiry never depends on this cleanup completing.
    await env.DB.prepare('DELETE FROM binders WHERE id IN (SELECT id FROM binders WHERE expires_at <= ? ORDER BY expires_at LIMIT 10)')
      .bind(Date.now()).run();
  },
} satisfies ExportedHandler<Bindings>;
