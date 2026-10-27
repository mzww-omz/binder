import { expect, test } from 'vitest';
import { creationBucket } from '../src/creation-limit';
const secret = 'test-only-daily-limit-secret-at-least-32-characters';

test('uses a stable daily HMAC without storing or returning the raw IP', async () => {
  const first = await creationBucket('203.0.113.1', secret, Date.parse('2026-10-26T00:00:00Z'));
  const second = await creationBucket('203.0.113.1', secret, Date.parse('2026-10-26T14:59:59.999Z'));
  expect(first).toEqual(second);
  expect(first?.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(first)).not.toContain('203.0.113.1');
  expect(first?.resetAt).toBe(Date.parse('2026-10-26T15:00:00Z'));
  expect((await creationBucket('203.0.113.2', secret, Date.parse('2026-10-26T00:00:00Z')))?.hash).not.toBe(first?.hash);
});

test('resets at exactly midnight Japan time and makes daily hashes unlinkable without the secret', async () => {
  const before = await creationBucket('203.0.113.1', secret, Date.parse('2026-10-26T14:59:59.999Z'));
  const after = await creationBucket('203.0.113.1', secret, Date.parse('2026-10-26T15:00:00Z'));
  expect(after?.hash).not.toBe(before?.hash);
  expect(after?.resetAt).toBe(Date.parse('2026-10-27T15:00:00Z'));
  expect((await creationBucket('203.0.113.1', secret + 'different', Date.parse('2026-10-26T00:00:00Z')))?.hash).not.toBe(before?.hash);
});

test.each([
  ['2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001'],
  ['192.0.2.1', '::ffff:c000:201'],
])('normalizes equivalent client IPs %s and %s', async (a, b) => {
  const first = await creationBucket(a, secret, 0);
  expect(first).not.toBeNull();
  expect(first).toEqual(await creationBucket(b, secret, 0));
});

test.each([undefined, '', 'example.com', '127.0.0.1, 10.0.0.1', '999.1.1.1', 'fe80::1%eth0', '1.2.3.4/path'])('fails closed for an invalid or absent client IP %s', async ip => {
  expect(await creationBucket(ip, secret, 0)).toBeNull();
});

test.each([undefined, '', 'too-short'])('fails closed without a suitable HMAC secret', async value => {
  expect(await creationBucket('192.0.2.1', value, 0)).toBeNull();
});
