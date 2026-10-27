import { decodeHTML, decodeHTMLAttribute } from 'entities';

export interface Metadata { title: string | null; icon: { bytes: Uint8Array; type: string } | null }
const HTML_LIMIT = 262144, ICON_LIMIT = 32768, TIMEOUT = 2500;

export function publicAddress(address: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const [a, b, c, d] = address.split('.').map(Number);
    if ([a, b, c, d].some(part => part > 255)) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  try {
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const groups = normalized.split(':');
    const first = parseInt(groups[0], 16), second = parseInt(groups[1] || '0', 16);
    // Only global unicast IPv6; exclude transition, protocol-assignment and documentation ranges.
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      !(first === 0x3fff && second < 0x1000);
  } catch { return false; }
}
export function publicUrl(value: string, selfOrigin: string): URL | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 2048) return null;
    const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
    if (hostname === new URL(selfOrigin).hostname.replace(/\.$/, '').toLowerCase()) return null;
    if (hostname.startsWith('[') || /^[\d.]+$/.test(hostname)) {
      if (!publicAddress(hostname.replace(/^\[|\]$/g, ''))) return null;
    } else if (!hostname.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/.test(hostname)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

async function readBytes(response: Response, limit: number, signal: AbortSignal, prefix = false): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      if (size + value.length > limit && !prefix) throw new Error('Response too large');
      const chunk = value.slice(0, limit - size); chunks.push(chunk); size += chunk.length;
      if (prefix && size === limit) break;
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  } finally {
    signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
function decodeTitle(raw: string) {
  return decodeHTML(raw).replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200).trim();
}
async function parseHtml(bytes: Uint8Array, page: URL, contentType: string) {
  let rawTitle = '', inFirstTitle = false, foundTitle = false;
  const icons: { href: string; rank: number }[] = [];
  const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? 'utf-8';
  const html = new TextDecoder(charset).decode(bytes);
  const rewritten = new HTMLRewriter()
    .on('title', {
      element(element) {
        if (foundTitle) return;
        foundTitle = true; inFirstTitle = true;
        element.onEndTag(() => { inFirstTitle = false; });
      },
      text(text) { if (inFirstTitle && rawTitle.length < 4096) rawTitle += text.text.slice(0, 4096 - rawTitle.length); },
    })
    .on('link', { element(element) {
      if (icons.length >= 8 || !decodeHTMLAttribute(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('icon')) return;
      const href = element.getAttribute('href'); if (!href) return;
      const sizes = element.getAttribute('sizes') ?? '';
      const rank = /(^|\s)(16x16|32x32|any)(\s|$)/i.test(sizes) ? 0 : 1;
      try { icons.push({ href: new URL(decodeHTMLAttribute(href), page).href, rank }); } catch { /* Invalid declarations use /favicon.ico. */ }
    } }).transform(new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  await rewritten.arrayBuffer();
  return { title: decodeTitle(rawTitle) || null, icon: icons.sort((a, b) => a.rank - b.rank)[0]?.href };
}
function image(bytes: Uint8Array, contentType: string): Metadata['icon'] {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'image/png' && bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width > 0 && width <= 512 && height > 0 && height <= 512) return { bytes, type };
  }
  if (['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico'].includes(type) && bytes.length >= 22 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint16(4, true);
    if (count > 0 && count <= 16 && bytes.length >= 6 + count * 16) {
      for (let i = 0; i < count; i++) {
        const start = 6 + i * 16, size = view.getUint32(start + 8, true), offset = view.getUint32(start + 12, true);
        if (!size || offset < 6 + count * 16 || offset + size > bytes.length) return null;
        if (size >= 8 && bytes[offset] === 137 && bytes[offset + 1] === 80 &&
          !image(bytes.slice(offset, offset + size), 'image/png')) return null;
      }
      return { bytes, type: 'image/x-icon' };
    }
  }
  if (type === 'image/svg+xml') {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    // Conservative SVG subset: no active content, references, CSS, filters or XML entities.
    if (/^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s>]/i.test(text) && !/<!|<(?:script|foreignObject|image|use|style|a|animate\w*|set|filter|fe\w*)[\s>]|\bon\w+\s*=|\b(?:href|style)\s*=|url\s*\(/i.test(text)) return { bytes, type };
  }
  return null;
}

export async function collectMetadata(value: string, selfOrigin: string): Promise<Metadata> {
  const initial = publicUrl(value, selfOrigin);
  if (!initial) return { title: null, icon: null };
  const controller = new AbortController(), signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const hosts = new Map<string, Promise<void>>();
  async function checkDns(url: URL) {
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (publicAddress(host)) return;
    if (!hosts.has(host)) hosts.set(host, (async () => {
      const answers = await Promise.all(['A', 'AAAA'].map(async type => {
        const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
          headers: { Accept: 'application/dns-json' }, redirect: 'manual', signal,
        });
        if (!response.ok) { void response.body?.cancel(); throw new Error('DNS unavailable'); }
        const result = JSON.parse(new TextDecoder().decode(await readBytes(response, 32768, signal))) as {
          Status: number; TC?: boolean; Answer?: { type: number; data: string }[];
        };
        if (result.Status !== 0 || result.TC) throw new Error('DNS unavailable');
        return (result.Answer ?? []).filter(answer => answer.type === 1 || answer.type === 28).map(answer => answer.data);
      }));
      const addresses = answers.flat();
      if (!addresses.length || addresses.some(address => !publicAddress(address))) throw new Error('Non-public DNS');
    })());
    await hosts.get(host);
  }
  async function get(value: string) {
    let next = value;
    for (let redirects = 0; redirects <= 2; redirects++) {
      signal.throwIfAborted();
      const url = publicUrl(next, selfOrigin); if (!url) throw new Error('Unsafe destination');
      await checkDns(url);
      // Cloudflare's strictly-public egress is the final network boundary (also for DNS rebinding).
      const response = await fetch(url.href, { method: 'GET', redirect: 'manual', signal,
        headers: { Accept: 'text/html,image/png,image/x-icon,image/svg+xml;q=0.9', 'User-Agent': 'Binder-Metadata/1.0' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location'); void response.body?.cancel();
        if (!location) throw new Error('Missing redirect');
        next = new URL(location, url).href; continue;
      }
      if (!response.ok) { void response.body?.cancel(); throw new Error('Fetch failed'); }
      return { response, url };
    }
    throw new Error('Redirect limit');
  }
  let title: string | null = null, declared: string | undefined, page = initial;
  try {
    try {
      const result = await get(initial.href); page = result.url;
      const type = result.response.headers.get('Content-Type') ?? '';
      if (!/^text\/html(?:\s*;|\s*$)/i.test(type)) { void result.response.body?.cancel(); throw new Error('Not HTML'); }
      const parsed = await parseHtml(await readBytes(result.response, HTML_LIMIT, signal, true), page, type);
      title = parsed.title; declared = parsed.icon;
    } catch { /* Metadata failure never prevents saving the link. */ }
    const fallback = new URL('/favicon.ico', page).href;
    for (const href of [...new Set([declared, fallback].filter((href): href is string => !!href))]) {
      try {
        const { response } = await get(href);
        const icon = image(await readBytes(response, ICON_LIMIT, signal), response.headers.get('Content-Type') ?? '');
        if (icon) return { title, icon };
      } catch { /* Try /favicon.ico, otherwise keep the generic link icon. */ }
    }
    return { title, icon: null };
  } finally { clearTimeout(timer); controller.abort(); }
}
