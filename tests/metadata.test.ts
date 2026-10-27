import { expect, test, vi, afterEach } from 'vitest';
import { collectMetadata, publicAddress, publicUrl } from '../src/metadata';

afterEach(() => vi.restoreAllMocks());
const self = 'https://binder.test';
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,16,0,0,0,16]);
function network(routes: Record<string, () => Response | Promise<Response>>, addresses = ['93.184.216.34']) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'cloudflare-dns.com') {
      const ipv6 = url.searchParams.get('type') === 'AAAA';
      return Response.json({ Status: 0, Answer: ipv6 ? [] : addresses.map(data => ({ type: 1, data })) });
    }
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    return routes[url.href]?.() ?? new Response(null, { status: 404 });
  });
}
const html = (value: string) => () => new Response(value, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

test.each([
  ['93.184.216.34', true], ['8.8.8.8', true], ['2606:4700:4700::1111', true],
  ['127.0.0.1', false], ['0.0.0.0', false], ['10.1.2.3', false], ['100.64.0.1', false],
  ['169.254.169.254', false], ['172.31.1.1', false], ['192.168.1.1', false],
  ['192.0.2.1', false], ['198.18.0.1', false], ['198.51.100.1', false], ['203.0.113.1', false],
  ['224.0.0.1', false], ['255.255.255.255', false], ['::1', false], ['::', false],
  ['::ffff:127.0.0.1', false], ['fc00::1', false], ['fe80::1', false], ['ff02::1', false],
  ['2001:db8::1', false], ['2002:7f00:1::', false], ['2001::1', false], ['3fff::1', false],
])('classifies IP %s without permitting internal/reserved routes', (address, expected) => expect(publicAddress(address)).toBe(expected));

test.each(['http://localhost/', 'http://localhost./', 'http://x.localhost/', 'http://intranet/', 'http://x.internal/',
  'http://x.local/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::ffff:7f00:1]/',
  'http://[fd00::1]/', 'http://10.0.0.1/', 'https://public.example:8443/', 'https://u:p@example.com/',
  'file:///etc/passwd', 'data:text/html,test', 'javascript:alert(1)', 'https://binder.test/api/binders'])('rejects unsafe target %s before fetching', async value => {
  const fetch = network({});
  expect(publicUrl(value, self)).toBeNull();
  expect(await collectMetadata(value, self)).toEqual({ title: null, icon: null });
  expect(fetch).not.toHaveBeenCalled();
});

test('extracts title, decodes entities once, normalizes whitespace and resolves relative favicon against final page URL', async () => {
  const fetch = network({
    'https://site.com/docs/page': html('<head><meta property="og:title" content="Wrong"><title>  A &amp; B&nbsp; &#x65E5;\n &copy; &amp;amp;  </title><link rel="shortcut icon" href="../assets/icon.png"></head>'),
    'https://site.com/assets/icon.png': () => new Response(png, { headers: { 'Content-Type': 'image/png' } }),
  });
  const metadata = await collectMetadata('https://site.com/docs/page', self);
  expect(metadata.title).toBe('A & B 日 © &amp;');
  expect(metadata.icon?.type).toBe('image/png');
  expect(metadata.icon?.bytes).toEqual(png);
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith('/favicon.ico'))).toBe(false);
});

test('uses Workers-supported manual redirects for the DNS resolver too', async () => {
  const fetch = network({ 'https://site.com/': html('<title>Works on Workers</title>') });
  await collectMetadata('https://site.com/', self);
  const queries = fetch.mock.calls.filter(([input]) => String(input).startsWith('https://cloudflare-dns.com/'));
  expect(queries).toHaveLength(2);
  for (const [, init] of queries) expect(init?.redirect).toBe('manual');
});

test('uses /favicon.ico when no declared icon is available and ignores og:title without a title', async () => {
  const ico = Uint8Array.from([0,0,1,0,1,0,16,16,0,0,1,0,32,0,4,0,0,0,22,0,0,0,0,0,0,0]);
  network({ 'https://site.com/': html('<meta property="og:title" content="Not the page title">'),
    'https://site.com/favicon.ico': () => new Response(ico, { headers: { 'Content-Type': 'image/vnd.microsoft.icon' } }) });
  const result = await collectMetadata('https://site.com/', self);
  expect(result.title).toBeNull(); expect(result.icon?.type).toBe('image/x-icon');
});

test('supports safe SVG; rejects active SVG and falls back after an invalid icon', async () => {
  network({ 'https://site.com/': html('<title>SVG</title><link rel="icon" href="/a.svg">'),
    'https://site.com/a.svg': () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16H0z"/></svg>', { headers: { 'Content-Type': 'image/svg+xml' } }) });
  expect((await collectMetadata('https://site.com/', self)).icon?.type).toBe('image/svg+xml');
  vi.restoreAllMocks();
  network({ 'https://site.com/': html('<title>Safe title</title><link rel="icon" href="/a.svg">'),
    'https://site.com/a.svg': () => new Response('<svg onload="alert(1)"><script>alert(1)</script></svg>', { headers: { 'Content-Type': 'image/svg+xml' } }) });
  expect(await collectMetadata('https://site.com/', self)).toEqual({ title: 'Safe title', icon: null });
});

test('limits HTML reads, handles chunked title text and bounds title length', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('<title>' + '名前 '.repeat(200) + '</title>' + 'x'.repeat(300000)));
    }, cancel() { cancelled = true; },
  });
  network({ 'https://site.com/': () => new Response(stream, { headers: { 'Content-Type': 'text/html' } }) });
  const result = await collectMetadata('https://site.com/', self);
  expect(result.title?.length).toBeLessThanOrEqual(200);
  expect(result.title?.startsWith('名前 名前')).toBe(true);
  expect(cancelled).toBe(true);
});

test('times out stalled response streams without blocking link fallback', async () => {
  let cancelled = false;
  network({ 'https://site.com/': () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/html' } }) });
  expect(await collectMetadata('https://site.com/', self)).toEqual({ title: null, icon: null });
  expect(cancelled).toBe(true);
}, 6000);

test('handles HTTP failures, non-HTML types, oversized icons and absent icons quietly', async () => {
  for (const response of [new Response(null, { status: 500 }), new Response('<title>Wrong type</title>', { headers: { 'Content-Type': 'application/json' } })]) {
    vi.restoreAllMocks(); network({ 'https://site.com/': () => response });
    expect(await collectMetadata('https://site.com/', self)).toEqual({ title: null, icon: null });
  }
  vi.restoreAllMocks();
  network({ 'https://site.com/': html('<title>Works</title><link rel="icon" href="/big.png">'),
    'https://site.com/big.png': () => new Response(new Uint8Array(40000), { headers: { 'Content-Type': 'image/png' } }) });
  expect(await collectMetadata('https://site.com/', self)).toEqual({ title: 'Works', icon: null });
});

test('follows bounded redirects and validates each destination, including icons', async () => {
  const fetch = network({
    'https://site.com/': () => new Response(null, { status: 302, headers: { Location: '/docs/page' } }),
    'https://site.com/docs/page': html('<title>Redirected</title><link rel="icon" href="/icon">'),
    'https://site.com/icon': () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/secrets' } }),
  });
  expect(await collectMetadata('https://site.com/', self)).toEqual({ title: 'Redirected', icon: null });
  expect(fetch.mock.calls.some(([input]) => String(input).includes('169.254.169.254'))).toBe(false);
  vi.restoreAllMocks();
  const loop = network({ 'https://site.com/': () => new Response(null, { status: 302, headers: { Location: '/' } }) });
  expect((await collectMetadata('https://site.com/', self)).title).toBeNull();
  expect(loop.mock.calls.filter(([input]) => String(input) === 'https://site.com/').length).toBeLessThanOrEqual(3);
});

test('rejects oversized PNGs hidden inside ICO containers', async () => {
  const payload = png.slice(); new DataView(payload.buffer).setUint32(16, 100000);
  const ico = new Uint8Array(22 + payload.length);
  ico.set([0,0,1,0,1,0,16,16,0,0,1,0,32,0,24,0,0,0,22,0,0,0]); ico.set(payload, 22);
  network({ 'https://site.com/': html('<title>Small icon only</title>'),
    'https://site.com/favicon.ico': () => new Response(ico, { headers: { 'Content-Type': 'image/x-icon' } }) });
  expect((await collectMetadata('https://site.com/', self)).icon).toBeNull();
});

test('resolves and checks a new hostname after a redirect', async () => {
  const fetch = network({ 'https://site.com/': () => new Response(null, { status: 302, headers: { Location: 'https://private-target.com/secret' } }) });
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (input, init) => {
    if (String(input).includes('name=private-target.com')) return Response.json({ Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] });
    return original(input, init);
  });
  expect((await collectMetadata('https://site.com/', self)).title).toBeNull();
  expect(fetch.mock.calls.some(([input]) => String(input).startsWith('https://private-target.com/'))).toBe(false);
});

test('rejects DNS answers containing any private address before contacting the site', async () => {
  const fetch = network({}, ['93.184.216.34', '127.0.0.1']);
  expect(await collectMetadata('https://site.com/', self)).toEqual({ title: null, icon: null });
  expect(fetch.mock.calls.every(([input]) => String(input).startsWith('https://cloudflare-dns.com/'))).toBe(true);
});
