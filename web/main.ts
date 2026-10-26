import './style.css';
import type { BinderData, BinderNode } from '../src/types';

const app = document.querySelector<HTMLElement>('#app')!;
const status = document.querySelector<HTMLElement>('#status')!;
const theme = document.querySelector<HTMLSelectElement>('#theme')!;
let data: BinderData | null = null;
let selected: string | null = null;
let busy = false;
let editable = false;
let form: { kind: 'folder' | 'link' | 'rename' | 'move' | 'delete' | 'delete-binder'; node?: BinderNode } | null = null;
const route = location.pathname.match(/^\/b\/([a-f0-9]{32})(\/edit)?$/);
const id = route?.[1];
const editing = !!route?.[2];
let token = editing ? location.hash.slice(1) : '';
const endpoint = `/api/binders/${id}`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function announce(message: string, error = false) {
  status.textContent = message;
  status.setAttribute('role', error ? 'alert' : 'status');
  status.classList.toggle('error', error);
}
function button(text: string, action: () => void, disabled = false, className = '') {
  const b = element('button', text, className);
  b.type = 'button'; b.disabled = busy || disabled; b.onclick = action;
  return b;
}
function applyTheme() {
  const value = theme.value;
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('binder-theme', value); } catch { /* Storage can be unavailable in private browsers. */ }
}
try {
  const stored = localStorage.getItem('binder-theme');
  if (stored && ['system', 'light', 'dark'].includes(stored)) theme.value = stored;
} catch { /* System remains the default. */ }
applyTheme();
theme.onchange = applyTheme;

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, cache: 'no-store', credentials: 'omit',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(editing && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' })) as { error: string };
    if (response.status === 404 && id) {
      data = null; editable = false; render();
    }
    throw new Error(error.error || 'Request failed');
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
async function operation(task: () => Promise<void>) {
  if (busy) return;
  busy = true;
  let failed = false;
  app.setAttribute('aria-busy', 'true');
  const controls = Array.from(app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select'));
  const disabled = controls.map(n => n.disabled);
  controls.forEach(n => { n.disabled = true; });
  try { await task(); }
  catch (error) { failed = true; announce(error instanceof Error ? error.message : 'Could not save. Try again.', true); }
  finally {
    busy = false;
    app.setAttribute('aria-busy', 'false');
    // Preserve unsaved input on failure; successful saves restore contextual controls.
    if (failed && data) controls.forEach((n, i) => { n.disabled = disabled[i]; });
    else { render(); app.querySelector<HTMLElement>('.toolbar button, .landing button')?.focus(); }
  }
}
function currentFolder() {
  const folder = new URLSearchParams(location.search).get('folder');
  return data?.nodes.some(n => n.id === folder && n.type === 'folder') ? folder! : null;
}
function navigate(folder: string | null) {
  const next = new URL(location.href);
  if (folder) next.searchParams.set('folder', folder); else next.searchParams.delete('folder');
  history.pushState(null, '', next);
  selected = null; form = null; render();
}
function siblings() { return data!.nodes.filter(n => n.parent_id === currentFolder()); }
function showForm(kind: NonNullable<typeof form>['kind'], node?: BinderNode) {
  form = { kind, node }; render();
  app.querySelector<HTMLElement>('.inline-form input, .inline-form select, .inline-form button')?.focus();
}
function folderPath(node: BinderNode) {
  const parts = [node.title];
  let parentId = node.parent_id;
  while (parentId) {
    const p = data!.nodes.find(n => n.id === parentId);
    if (!p) break;
    parts.unshift(p.title); parentId = p.parent_id;
  }
  return 'Binder / ' + parts.join(' / ');
}
async function reload() { data = await api<BinderData>(endpoint); }
async function copy(edit: boolean) {
  const value = `${location.origin}/b/${id}${edit ? '/edit#' + token : ''}`;
  try { await navigator.clipboard.writeText(value); announce(edit ? 'Edit URL copied. Keep it private; it cannot be recovered.' : 'Share URL copied.'); }
  catch {
    announce('Copy this URL manually:');
    const input = element('input'); input.readOnly = true; input.value = value;
    input.setAttribute('aria-label', edit ? 'Edit URL' : 'Share URL');
    status.append(input); input.focus(); input.select();
  }
}
function inputField(container: HTMLElement, label: string, value: string, type = 'text') {
  const wrapper = element('label', label);
  const input = element('input');
  input.type = type; input.value = value; input.required = true;
  input.maxLength = type === 'url' ? 2048 : 200;
  input.autocomplete = 'off';
  wrapper.append(input); container.append(wrapper);
  return input;
}
function renderForm() {
  if (!form || !editable) return;
  const current = form;
  const panel = element('form', undefined, 'inline-form');
  panel.setAttribute('aria-label', 'Edit item');
  const heading = { folder: 'New folder', link: 'New link', rename: 'Rename item', move: 'Move item', delete: 'Delete item', 'delete-binder': 'Delete Binder' }[current.kind];
  panel.append(element('h2', heading));
  if (current.kind === 'delete' || current.kind === 'delete-binder') {
    panel.append(element('p', current.kind === 'delete-binder' ? 'Delete this Binder and everything in it? This cannot be undone.' : `Delete “${current.node!.title}”${current.node!.type === 'folder' ? ' and everything inside it' : ''}? This cannot be undone.`));
    panel.append(button('Delete permanently', () => void operation(async () => {
      await api(current.kind === 'delete-binder' ? endpoint : `${endpoint}/nodes/${current.node!.id}`, 'DELETE');
      if (current.kind === 'delete-binder') { token = ''; location.replace('/'); return; }
      selected = null; form = null; await reload(); announce('Deleted.');
    }), false, 'danger'));
  } else {
    let name: HTMLInputElement | undefined, href: HTMLInputElement | undefined, destination: HTMLSelectElement | undefined;
    if (current.kind === 'move') {
      const label = element('label', 'Destination'); destination = element('select');
      const root = element('option', 'Binder'); root.value = ''; destination.append(root);
      const excluded = new Set<string>([current.node!.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of data!.nodes) if (n.parent_id && excluded.has(n.parent_id) && !excluded.has(n.id)) { excluded.add(n.id); changed = true; }
      }
      for (const n of data!.nodes.filter(n => n.type === 'folder' && !excluded.has(n.id))) {
        const option = element('option', folderPath(n)); option.value = n.id; destination.append(option);
      }
      destination.value = current.node!.parent_id ?? '';
      label.append(destination); panel.append(label);
    } else {
      name = inputField(panel, 'Name', current.node?.title ?? '');
      if (current.kind === 'link' || current.node?.type === 'link') href = inputField(panel, 'URL', current.node?.url ?? '', 'url');
    }
    const save = element('button', 'Save', 'primary'); save.type = 'submit'; save.disabled = busy;
    panel.append(save);
    panel.onsubmit = event => {
      event.preventDefault();
      const body = destination ? { parent_id: destination.value || null } : {
        title: name!.value, ...(href ? { url: href.value } : {}),
        ...(['folder', 'link'].includes(current.kind) ? { type: current.kind, parent_id: currentFolder() } : {}),
      };
      void operation(async () => {
        await api(current.node ? `${endpoint}/nodes/${current.node.id}` : `${endpoint}/nodes`, current.node ? 'PATCH' : 'POST', body);
        if (current.kind === 'move') selected = null;
        form = null; await reload(); announce('Saved.');
      });
    };
  }
  panel.append(button('Cancel', () => { form = null; render(); }));
  panel.onkeydown = event => { if (event.key === 'Escape') { form = null; render(); } };
  app.append(panel);
}
async function reorder(direction: -1 | 1) {
  const nodes = siblings(), index = nodes.findIndex(n => n.id === selected);
  if (index < 0 || !nodes[index + direction]) return;
  [nodes[index], nodes[index + direction]] = [nodes[index + direction], nodes[index]];
  await operation(async () => {
    await api(`${endpoint}/reorder`, 'PUT', { parent_id: currentFolder(), ids: nodes.map(n => n.id) });
    await reload(); announce('Order saved.');
  });
}
function render() {
  app.replaceChildren(); app.setAttribute('aria-busy', String(busy));
  if (!id) {
    if (location.pathname !== '/') { app.append(element('h1', 'Page not found')); return; }
    const landing = element('section', undefined, 'landing');
    landing.append(element('h1', 'Binder'), element('p', 'A temporary place for links.', 'muted'));
    landing.append(button('Create Binder', () => void operation(async () => {
      const b = await api<{ id: string; edit_token: string }>('/api/binders', 'POST', {});
      location.assign(`/b/${b.id}/edit#${b.edit_token}`);
    }), false, 'primary'));
    landing.append(element('p', 'No account. Automatically deleted after 7 days.', 'footnote'));
    app.append(landing); return;
  }
  if (!data) {
    app.append(element('h1', 'Binder unavailable'), element('p', 'It may have expired or been deleted.', 'muted'));
    app.append(button('Retry', () => void initialize()));
    const home = element('a', 'Create a new Binder'); home.href = '/'; app.append(home); return;
  }
  const top = element('div', undefined, 'binder-heading');
  top.append(element('p', editable ? 'EDITING' : 'READ ONLY', 'eyebrow'));
  if (editable) {
    const sharing = element('div', undefined, 'sharing');
    sharing.append(button('Copy Share URL', () => void copy(false)), button('Copy Edit URL', () => void copy(true)));
    top.append(sharing);
  }
  app.append(top);
  const breadcrumbs = element('nav', undefined, 'breadcrumbs'); breadcrumbs.setAttribute('aria-label', 'Folders');
  breadcrumbs.append(button(data.title, () => navigate(null)));
  const folder = data.nodes.find(n => n.id === currentFolder());
  const ancestors: BinderNode[] = [];
  let ancestor = folder;
  while (ancestor) { ancestors.unshift(ancestor); ancestor = data.nodes.find(n => n.id === ancestor!.parent_id); }
  for (const n of ancestors) {
    breadcrumbs.append(element('span', '/', 'muted'), button(n.title, () => navigate(n.id)));
  }
  breadcrumbs.lastElementChild?.setAttribute('aria-current', 'page');
  app.append(breadcrumbs);
  if (editable) {
    const toolbar = element('div', undefined, 'toolbar'); toolbar.setAttribute('aria-label', 'Item actions');
    const node = data.nodes.find(n => n.id === selected), items = siblings(), index = items.findIndex(n => n.id === selected);
    toolbar.append(button('New Folder', () => showForm('folder')), button('New Link', () => showForm('link')),
      element('span', undefined, 'toolbar-divider'),
      button('Rename', () => showForm('rename', node), !node), button('Move', () => showForm('move', node), !node),
      button('Delete', () => showForm('delete', node), !node),
      button('Move up', () => void reorder(-1), index <= 0), button('Move down', () => void reorder(1), index < 0 || index >= items.length - 1));
    app.append(toolbar);
  }
  renderForm();
  const table = element('table');
  const caption = element('caption', 'Folder contents', 'sr-only'); table.append(caption);
  const head = element('thead'), header = element('tr');
  if (editable) header.append(element('th', 'Select', 'sr-only-cell'));
  for (const text of ['Name', 'Type']) { const th = element('th', text); th.scope = 'col'; header.append(th); }
  head.append(header); table.append(head);
  const body = element('tbody');
  for (const n of siblings()) {
    const row = element('tr'); row.classList.toggle('selected', n.id === selected);
    if (editable) {
      const cell = element('td', undefined, 'selection');
      const radio = element('input'); radio.type = 'radio'; radio.name = 'selection'; radio.checked = n.id === selected;
      radio.setAttribute('aria-label', `Select ${n.title}`); radio.disabled = busy;
      radio.onchange = () => { selected = n.id; form = null; render(); app.querySelector<HTMLInputElement>('input:checked')?.focus(); };
      cell.append(radio); row.append(cell);
    }
    const cell = element('td', undefined, 'name-cell');
    const icon = element('span', undefined, n.type === 'folder' ? 'folder-icon' : 'link-icon'); icon.setAttribute('aria-hidden', 'true');
    let name: HTMLButtonElement | HTMLAnchorElement;
    if (n.type === 'folder') name = button(n.title, () => navigate(n.id), false, 'item-name');
    else {
      name = element('a', n.title, 'item-name'); name.href = n.url!; name.target = '_blank'; name.rel = 'noopener noreferrer';
      name.title = n.url!;
    }
    cell.append(icon, name); row.append(cell, element('td', n.type === 'folder' ? 'Folder' : 'Link', 'type-cell')); body.append(row);
  }
  if (!body.children.length) {
    const row = element('tr'), cell = element('td', editable ? 'No links or folders yet. Add one above.' : 'This folder is empty.', 'empty');
    cell.colSpan = editable ? 3 : 2; row.append(cell); body.append(row);
  }
  table.append(body); app.append(table);
  const footer = element('footer', undefined, 'binder-footer');
  const expiry = element('div'); expiry.append(element('p', '', 'countdown'));
  const absolute = element('time', `Deletes ${new Date(data.expires_at).toLocaleString()}`, 'footnote'); absolute.dateTime = new Date(data.expires_at).toISOString(); expiry.append(absolute); footer.append(expiry);
  if (editable) footer.append(button('Delete Binder', () => { showForm('delete-binder'); app.querySelector('.inline-form')?.scrollIntoView({ block: 'nearest' }); }, false, 'quiet-danger'));
  app.append(footer);
  if (editable) app.append(element('p', 'Keep your edit URL. Anyone with it can make changes; a lost URL cannot be recovered.', 'footnote edit-note'));
  updateExpiry();
}
function updateExpiry() {
  if (!data) return;
  const remaining = data.expires_at - Date.now();
  if (remaining <= 0) { data = null; editable = false; form = null; render(); announce('Binder expired. Its links are no longer available.', true); return; }
  const hours = Math.floor(remaining / 3600000), minutes = Math.floor(remaining / 60000) % 60;
  const countdown = app.querySelector('.countdown');
  if (countdown) countdown.textContent = `Expires in ${hours >= 24 ? Math.floor(hours / 24) + 'd ' : ''}${hours % 24}h ${minutes}m`;
}
async function initialize() {
  busy = true; app.setAttribute('aria-busy', 'true'); announce('');
  try {
    if (id) {
      await reload();
      if (editing) {
        await api(`${endpoint}/access`);
        editable = true;
      }
    }
  } catch (error) {
    editable = false;
    announce(error instanceof Error ? error.message : 'Could not load Binder. Check your connection and retry.', true);
  } finally { busy = false; render(); }
}
window.addEventListener('popstate', () => { selected = null; form = null; render(); });
window.addEventListener('hashchange', () => { token = editing ? location.hash.slice(1) : ''; editable = false; void initialize(); });
setInterval(updateExpiry, 1000);
void initialize();
