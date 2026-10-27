const DAY = 86400000, JST_OFFSET = 9 * 3600000;

function normalizeIp(ip: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every(part => part <= 255) ? parts.join('.') : null;
  }
  if (!ip.includes(':')) return null;
  try {
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const mapped = normalized.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
    return normalized;
  } catch { return null; }
}

export async function creationBucket(ip: string | undefined, secret: string | undefined, now: number): Promise<{ hash: string; resetAt: number } | null> {
  if (!ip || !secret || secret.length < 32) return null;
  const normalized = normalizeIp(ip); if (!normalized) return null;
  const day = Math.floor((now + JST_OFFSET) / DAY);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`binder-create:${day}:${normalized}`));
  return {
    hash: Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join(''),
    resetAt: (day + 1) * DAY - JST_OFFSET,
  };
}
