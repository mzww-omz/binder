// Deterministic UI fixtures; the Worker/D1/outbound integration is tested separately.
export async function runMetadata(page) {
  const equal = (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); };
  await page.clock.setSystemTime(new Date());
  await page.setViewportSize({ width: 1280, height: 800 });
  const origin = 'http://localhost:8787', id = 'a'.repeat(32), base = `/api/binders/${id}`;
  const binder = { id, title: 'Binder', created_at: Date.now(), updated_at: Date.now(), expires_at: Date.now() + 604800000 };
  const legacy = { id: 'b'.repeat(32), binder_id: id, parent_id: null, type: 'link', title: '以前の手動タイトル', url: 'https://old.com/', sort_order: 0, created_at: Date.now(), updated_at: Date.now() };
  const nodes = [legacy], polls = new Map();
  let created = 0;
  await page.route(`${origin}${base}`, async route => {
    for (const node of nodes) if (node.metadata_status === 'pending') {
      const count = (polls.get(node.id) ?? 0) + 1; polls.set(node.id, count);
      if (count >= 2) { node.title = '自動取得したページタイトル'; node.metadata_status = 'ready'; node.favicon_url = `${base}/nodes/${node.id}/favicon?v=1`; }
    }
    await route.fulfill({ json: { ...binder, nodes } });
  });
  await page.route(`${origin}${base}/access`, route => route.fulfill({ json: { editable: true } }));
  await page.route(`${origin}${base}/nodes`, async route => {
    const body = route.request().postDataJSON(); equal(body.title, undefined);
    const node = { ...legacy, id: String(++created).repeat(32), title: new URL(body.url).hostname, url: body.url,
      sort_order: created, metadata_status: 'pending', favicon_url: null };
    nodes.push(node); await route.fulfill({ status: 201, json: node });
  });
  await page.route(`${origin}${base}/nodes/*`, async route => {
    const node = nodes.find(node => route.request().url().endsWith('/' + node.id));
    Object.assign(node, route.request().postDataJSON()); await route.fulfill({ json: node });
  });
  await page.route(`${origin}${base}/nodes/*/favicon*`, async route => {
    if (route.request().url().includes('/' + '2'.repeat(32) + '/')) { await route.fulfill({ status: 404 }); return; }
    await route.fulfill({ headers: { 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' }, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="3" fill="#7058b8"/><path d="M5 5h8v3H8v2h5v3H5z" fill="white"/></svg>' });
  });
  try {
    await page.goto(origin);
    await page.goto(`${origin}/b/${id}/edit#${'c'.repeat(64)}`);
    await page.getByRole('link', { name: '以前の手動タイトル', exact: true }).waitFor();
    const input = page.getByRole('textbox', { name: 'リンクを追加', exact: true });
    await input.fill('https://site.com/page'); await input.press('Enter');
    await page.getByRole('link', { name: 'site.com', exact: true }).waitFor(); equal(await input.isEnabled(), true);
    await page.getByRole('link', { name: '自動取得したページタイトル', exact: true }).waitFor({ timeout: 10000 });
    const row = page.locator(`[data-node-id="${'1'.repeat(32)}"]`), img = row.locator('img');
    await img.waitFor(); await page.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    equal(await img.getAttribute('width'), '18'); equal(await img.getAttribute('alt'), '');
    equal(await row.locator('.node-domain').textContent(), 'site.com');
    const titleBounds = await row.locator('.node-name').boundingBox(), hostBounds = await row.locator('.node-domain').boundingBox();
    equal(hostBounds.y > titleBounds.y, true);
    await page.getByLabel('テーマ', { exact: true }).selectOption('light');
    await page.screenshot({ path: '/tmp/binder-metadata-light.png', fullPage: true });
    await input.fill('https://other.com/page'); await input.press('Enter');
    await page.getByRole('link', { name: 'other.com', exact: true }).waitFor();
    const ready = page.waitForResponse(async response => response.url() === origin + base && (await response.json()).nodes.some(node => node.id === '2'.repeat(32) && node.metadata_status === 'ready'));
    await page.getByRole('button', { name: '「other.com」の操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '名前を変更', exact: true }).click();
    await page.getByRole('textbox', { name: 'リンク名', exact: true }).fill('自分で付けた名前');
    await ready;
    equal(await page.getByRole('textbox', { name: 'リンク名', exact: true }).inputValue(), '自分で付けた名前');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('link', { name: '自分で付けた名前', exact: true }).waitFor();
    await page.locator(`[data-node-id="${'2'.repeat(32)}"] img`).waitFor({ state: 'detached' });
    equal(await page.getByRole('link', { name: '以前の手動タイトル', exact: true }).count(), 1);
    await page.getByLabel('テーマ', { exact: true }).selectOption('dark'); await page.setViewportSize({ width: 375, height: 812 });
    equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '/tmp/binder-metadata-dark.png', fullPage: true });
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
}
