import './style.css';
import { element, button, icon, iconButton, showMenu, closeMenu, localizeInput } from './ui';
import { apiErrorMessage, remainingTime } from './locale';
import type { BinderData, BinderNode } from '../src/types';

const app = document.querySelector<HTMLElement>('#app')!;
const theme = document.querySelector<HTMLSelectElement>('#theme')!;
const route = location.pathname.match(/^\/b\/([a-f0-9]{32})(\/edit)?$/);
const id = route?.[1], editing = !!route?.[2];
const endpoint = `/api/binders/${id}`;
let token = editing ? location.hash.slice(1) : '';
let data: BinderData | null = null;
let editable = false, busy = false, loadVersion = 0;
let mode: { kind: 'folder' | 'rename' | 'edit' | 'move' | 'delete' | 'delete-binder'; node?: BinderNode } | null = null;
let shell: ReturnType<typeof mountBinder> | null = null;
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, cache: 'no-store', credentials: 'omit',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(editing && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => { throw new Error('通信できませんでした。接続を確認して、もう一度お試しください。'); });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new ApiError(apiErrorMessage(error?.error, response.status), response.status);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
function feedback(target: HTMLElement, text: string, error = false) {
  clearTimeout(timers.get(target));
  target.replaceChildren(element('span', text)); target.hidden = false;
  target.classList.toggle('error', error); target.setAttribute('role', error ? 'alert' : 'status');
  if (!error) timers.set(target, setTimeout(() => { target.replaceChildren(); target.hidden = true; }, 3500));
}
function notice() {
  const node = element('div', undefined, 'feedback'); node.setAttribute('role', 'status'); node.hidden = true;
  return node;
}
async function perform(task: () => Promise<void>, target: HTMLElement) {
  if (busy) return false;
  busy = true; closeMenu(); app.setAttribute('aria-busy', 'true');
  const controls = Array.from(app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select'));
  const disabled = controls.map(node => node.disabled);
  controls.forEach(node => { node.disabled = true; });
  feedback(target, '保存中…');
  try { await task(); return true; }
  catch (error) {
    const destination = target.isConnected ? target : shell?.notice;
    if (destination) {
      feedback(destination, error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。', true);
      if (error instanceof ApiError && [404, 409].includes(error.status)) {
        destination.append(button('再読み込み', () => void initialize(), 'text-button'));
      }
    }
    return false;
  } finally {
    busy = false; app.setAttribute('aria-busy', 'false');
    controls.forEach((node, index) => { if (node.isConnected) node.disabled = disabled[index]; });
  }
}
function applyTheme() {
  document.documentElement.dataset.theme = theme.value;
  try { localStorage.setItem('binder-theme', theme.value); } catch { /* Storage may be unavailable. */ }
}
try {
  const value = localStorage.getItem('binder-theme');
  if (value && ['system', 'light', 'dark'].includes(value)) theme.value = value;
} catch { /* System remains the default. */ }
applyTheme(); theme.onchange = applyTheme;

function currentFolder() {
  const folder = new URLSearchParams(location.search).get('folder');
  return data?.nodes.some(node => node.id === folder && node.type === 'folder') ? folder! : null;
}
function siblings() {
  return data!.nodes.filter(node => node.parent_id === currentFolder())
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}
function upsert(node: BinderNode) {
  const index = data!.nodes.findIndex(item => item.id === node.id);
  if (index < 0) data!.nodes.push(node); else data!.nodes[index] = node;
}
function subtree(id: string) {
  const ids = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of data!.nodes) if (node.parent_id && ids.has(node.parent_id) && !ids.has(node.id)) {
      ids.add(node.id); changed = true;
    }
  }
  return ids;
}
function folderPath(node: BinderNode) {
  const names = [node.title];
  let parent = node.parent_id;
  while (parent) {
    const ancestor = data!.nodes.find(item => item.id === parent);
    if (!ancestor) break;
    names.unshift(ancestor.title); parent = ancestor.parent_id;
  }
  return `${data!.title} / ${names.join(' / ')}`;
}
function navigate(folder: string | null, push = true) {
  if (!data) return;
  closeMenu(); mode = null;
  if (push) {
    const next = new URL(location.href);
    if (folder) next.searchParams.set('folder', folder); else next.searchParams.delete('folder');
    history.pushState(null, '', next);
  }
  renderLocation();
  shell?.breadcrumbs.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
}
function focusRow(id?: string) {
  const target = id ? shell?.list.querySelector<HTMLElement>(`[data-node-id="${id}"] .item-trigger`) : shell?.newFolder;
  (target ?? shell?.url)?.focus();
}
function cancel() {
  if (busy) return;
  const nodeId = mode?.node?.id;
  mode = null; renderRows(); shell?.panel.replaceChildren(); focusRow(nodeId);
}
function openEditor(kind: NonNullable<typeof mode>['kind'], node?: BinderNode) {
  mode = { kind, node }; closeMenu();
  shell!.panel.replaceChildren(); renderRows();
  const row = kind === 'folder' ? shell!.list.querySelector('.draft') :
    kind === 'delete-binder' ? shell!.panel : shell!.list.querySelector(`[data-node-id="${node!.id}"]`);
  if (kind === 'delete-binder') row!.append(editor());
  row?.querySelector<HTMLElement>('input, select, .cancel-button')?.focus();
}
async function copy(edit: boolean) {
  const value = `${location.origin}/b/${id}${edit ? '/edit#' + token : ''}`;
  try {
    await navigator.clipboard.writeText(value);
    if (shell) feedback(shell.shareNotice, edit ? '編集用URLをコピーしました。他の人に渡さないでください。' : '共有URLをコピーしました。');
  } catch {
    if (!shell) return;
    if (edit) feedback(shell.shareNotice, 'コピーできませんでした。アドレスバーから編集用URLをコピーし、他の人に渡さないでください。', true);
    else {
      feedback(shell.shareNotice, '共有URLを手動でコピーしてください。', true);
      const input = element('input'); input.value = value; input.readOnly = true; input.setAttribute('aria-label', '共有URL');
      shell.shareNotice.append(input); input.focus(); input.select();
    }
  }
}
function itemMenu(node: BinderNode, trigger: HTMLButtonElement, point?: { x: number; y: number }) {
  if (busy || !editable) return;
  const items = siblings(), index = items.findIndex(item => item.id === node.id);
  showMenu(trigger, [
    { label: '名前を変更', action: () => openEditor('rename', node) },
    ...(node.type === 'link' ? [{ label: '編集', action: () => openEditor('edit', node) }] : []),
    { label: '移動', action: () => openEditor('move', node) },
    null,
    { label: '上へ移動', disabled: index <= 0, action: () => void reorder(node, -1) },
    { label: '下へ移動', disabled: index >= items.length - 1, action: () => void reorder(node, 1) },
    null,
    { label: '削除', danger: true, action: () => openEditor('delete', node) },
  ], point);
}
async function reorder(node: BinderNode, direction: -1 | 1) {
  const items = siblings(), index = items.findIndex(item => item.id === node.id);
  if (index < 0 || !items[index + direction]) return;
  [items[index], items[index + direction]] = [items[index + direction], items[index]];
  if (await perform(async () => {
    await api(`${endpoint}/reorder`, 'PUT', { parent_id: currentFolder(), ids: items.map(item => item.id) });
    items.forEach((item, order) => { item.sort_order = order; });
  }, shell!.notice)) {
    renderRows(); focusRow(node.id); feedback(shell!.notice, '並び順を変更しました。');
  }
}
function field(form: HTMLElement, label: string, value: string, type = 'text') {
  const wrapper = element('label', label), input = element('input');
  input.type = type; input.value = value; input.required = true; input.autocomplete = 'off';
  input.maxLength = type === 'url' ? 2048 : 200;
  localizeInput(input, label);
  wrapper.append(input); form.append(wrapper); return input;
}
function editor() {
  const current = mode!;
  const form = element('form', undefined, `row-editor ${current.kind === 'folder' || current.kind === 'rename' ? 'inline-name' : ''}`);
  form.setAttribute('aria-label', current.kind === 'folder' ? 'フォルダーを作成' : '項目を編集');
  const error = notice();
  const cancelButton = button('キャンセル', cancel, 'cancel-button');
  if (current.kind === 'delete' || current.kind === 'delete-binder') {
    form.classList.add('delete-confirm');
    form.append(element('p', current.kind === 'delete-binder' ? 'このBinderと中の項目をすべて削除しますか？この操作は取り消せません。' :
      `「${current.node!.title}」${current.node!.type === 'folder' ? 'と中の項目をすべて' : 'を'}削除しますか？この操作は取り消せません。`));
    form.append(cancelButton, button('削除する', () => void (async () => {
      if (await perform(async () => {
        await api(current.kind === 'delete-binder' ? endpoint : `${endpoint}/nodes/${current.node!.id}`, 'DELETE');
        if (current.kind !== 'delete-binder') {
          const ids = subtree(current.node!.id); data!.nodes = data!.nodes.filter(node => !ids.has(node.id));
        }
      }, error)) {
        if (current.kind === 'delete-binder') { token = ''; location.replace('/'); return; }
        mode = null; renderRows(); shell?.url.focus(); feedback(shell!.notice, '項目を削除しました。');
      }
    })(), 'danger-button'));
  } else {
    let name: HTMLInputElement | undefined, url: HTMLInputElement | undefined, destination: HTMLSelectElement | undefined;
    if (current.kind === 'move') {
      const label = element('label', '移動先'); destination = element('select'); destination.setAttribute('aria-label', '移動先');
      const root = element('option', data!.title); root.value = ''; destination.append(root);
      const excluded = subtree(current.node!.id);
      for (const folder of data!.nodes.filter(node => node.type === 'folder' && !excluded.has(node.id))) {
        const option = element('option', folderPath(folder)); option.value = folder.id; destination.append(option);
      }
      destination.value = current.node!.parent_id ?? ''; label.append(destination); form.append(label);
    } else {
      name = field(form, current.kind === 'edit' ? '名前' : current.node?.type === 'link' ? 'リンク名' : 'フォルダー名', current.node?.title ?? '');
      if (current.kind !== 'edit') name.parentElement!.classList.add('name-field');
      if (current.kind === 'edit') url = field(form, 'URL', current.node!.url!, 'url');
    }
    const save = element('button', current.kind === 'move' ? 'ここに移動' : '保存', 'primary'); save.type = 'submit';
    form.append(save, cancelButton);
    form.onsubmit = event => {
      event.preventDefault();
      const body = destination ? { parent_id: destination.value || null } : {
        title: name!.value.trim(), ...(url ? { url: url.value.trim() } : {}),
        ...(current.kind === 'folder' ? { type: 'folder', parent_id: currentFolder() } : {}),
      };
      void (async () => {
        let saved: BinderNode | undefined;
        if (await perform(async () => {
          saved = await api<BinderNode>(current.node ? `${endpoint}/nodes/${current.node.id}` : `${endpoint}/nodes`, current.node ? 'PATCH' : 'POST', body);
          upsert(saved);
        }, error)) {
          mode = null; renderRows(); focusRow(current.kind === 'move' ? undefined : saved!.id);
          feedback(shell!.notice, current.kind === 'folder' ? 'フォルダーを作成しました。' : current.kind === 'move' ? '項目を移動しました。' : '変更を保存しました。');
        } else name?.focus();
      })();
    };
  }
  form.append(error);
  form.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
  return form;
}
function renderRows() {
  if (!shell || !data) return;
  shell.list.replaceChildren();
  if (mode?.kind === 'folder') {
    const draft = element('li', undefined, 'node draft'); draft.append(icon('folder'), editor()); shell.list.append(draft);
  }
  for (const node of siblings()) {
    const row = element('li', undefined, 'node'); row.dataset.nodeId = node.id;
    if (mode?.node?.id === node.id && mode.kind === 'rename') {
      row.append(icon(node.type), editor()); shell.list.append(row); continue;
    }
    const content = element('div', undefined, 'node-content');
    const name = node.type === 'folder' ? button('', () => navigate(node.id), 'node-open') : element('a', undefined, 'node-open');
    if (name instanceof HTMLAnchorElement) { name.href = node.url!; name.target = '_blank'; name.rel = 'noopener noreferrer'; }
    name.append(icon(node.type), element('span', node.title, 'node-name'));
    content.append(name);
    if (node.type === 'link') {
      const parsed = new URL(node.url!);
      const detail = node.title === parsed.hostname ? parsed.pathname : parsed.hostname;
      const domain = element('span', detail, 'node-domain'); domain.title = node.url!; content.append(domain);
    }
    row.append(content);
    if (editable) {
      const trigger = iconButton(`「${node.title}」の操作`, 'more', () => itemMenu(node, trigger)); trigger.classList.add('item-trigger');
      trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false'); row.append(trigger);
      row.oncontextmenu = event => { event.preventDefault(); itemMenu(node, trigger, { x: event.clientX, y: event.clientY }); };
      row.onkeydown = event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); itemMenu(node, trigger); }
      };
    }
    if (mode?.node?.id === node.id) row.append(editor());
    shell.list.append(row);
  }
  if (!shell.list.children.length) shell.list.append(element('li', editable ? 'URLを貼り付けるか、フォルダーを作成してください。' : 'このフォルダーは空です。', 'empty'));
}
function renderLocation() {
  if (!shell || !data) return;
  shell.panel.replaceChildren(); shell.breadcrumbs.replaceChildren();
  const root = button(data.title, () => navigate(null)); shell.breadcrumbs.append(root);
  const ancestors: BinderNode[] = [];
  let ancestor = data.nodes.find(node => node.id === currentFolder());
  while (ancestor) { ancestors.unshift(ancestor); ancestor = data.nodes.find(node => node.id === ancestor!.parent_id); }
  for (const node of ancestors) shell.breadcrumbs.append(element('span', '/', 'separator'), button(node.title, () => navigate(node.id)));
  shell.breadcrumbs.lastElementChild?.setAttribute('aria-current', 'page');
  renderRows();
}
function mountBinder() {
  const header = element('section', undefined, 'binder-header');
  const identity = element('div', undefined, 'binder-identity');
  identity.append(element('h1', data!.title));
  const expiry = element('details', undefined, 'expiry'), countdown = element('summary', '', 'countdown');
  const absolute = element('time', `削除予定：${new Date(data!.expires_at).toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })}`);
  absolute.dateTime = new Date(data!.expires_at).toISOString(); expiry.append(countdown, absolute); identity.append(expiry);
  const sharing = element('div', undefined, 'sharing');
  sharing.append(button('共有', () => void copy(false), 'primary'));
  if (editable) {
    const options = iconButton('Binderのその他の操作', 'more', () => showMenu(options, [
      { label: '編集用URLをコピー', action: () => void copy(true) }, null,
      { label: 'Binderを削除', danger: true, action: () => openEditor('delete-binder') },
    ]));
    options.setAttribute('aria-haspopup', 'menu'); options.setAttribute('aria-expanded', 'false'); sharing.append(options);
  }
  header.append(identity, sharing);
  const shareNotice = notice(); shareNotice.classList.add('share-feedback'); header.append(shareNotice);
  const breadcrumbs = element('nav', undefined, 'breadcrumbs'); breadcrumbs.setAttribute('aria-label', 'フォルダーの階層');
  const panel = element('div', undefined, 'binder-panel');
  const composer = element('div', undefined, 'composer');
  const addForm = element('form', undefined, 'url-form'), url = element('input');
  url.type = 'url'; url.placeholder = 'URLを貼り付けてリンクを追加'; url.setAttribute('aria-label', 'リンクを追加');
  url.required = true; url.maxLength = 2048; url.autocomplete = 'off'; url.spellcheck = false;
  localizeInput(url, 'URL');
  const add = element('button', '追加'); add.type = 'submit';
  addForm.append(url, add);
  const newFolder = button('新しいフォルダー', () => openEditor('folder'), 'new-folder');
  const composerNotice = notice();
  addForm.onsubmit = event => {
    event.preventDefault();
    const value = url.value.trim();
    let parsed: URL;
    try {
      parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch { feedback(composerNotice, 'httpまたはhttpsで始まる、ユーザー名・パスワードを含まないURLを入力してください。', true); url.focus(); return; }
    const body = { type: 'link', title: parsed.hostname.slice(0, 200), url: value, parent_id: currentFolder() };
    void (async () => {
      if (await perform(async () => { upsert(await api<BinderNode>(`${endpoint}/nodes`, 'POST', body)); }, composerNotice)) {
        url.value = ''; renderRows(); feedback(composerNotice, 'リンクを追加しました。');
      }
      url.focus();
    })();
  };
  composer.append(addForm, newFolder);
  const list = element('ul', undefined, 'node-list'); list.setAttribute('aria-label', 'フォルダー内の項目');
  list.classList.toggle('view-only', !editable);
  app.replaceChildren(header, breadcrumbs, panel);
  if (editable) app.append(composer);
  app.append(composerNotice, list);
  return { header, countdown, shareNotice, breadcrumbs, panel, url, newFolder, notice: composerNotice, list };
}
function unavailable(message: string) {
  shell = null; mode = null; closeMenu();
  const section = element('section', undefined, 'unavailable'); section.append(element('h1', 'Binderを開けません'));
  const error = notice(); feedback(error, message, true); section.append(error);
  section.append(button('再試行', () => void initialize()));
  const home = element('a', '新しいBinderを作成', 'text-button'); home.href = '/'; section.append(home); app.replaceChildren(section);
}
function updateExpiry() {
  if (!data || !shell) return;
  const remaining = data.expires_at - Date.now();
  if (remaining <= 0) { data = null; editable = false; unavailable('有効期限が切れたため、このBinderのリンクは表示できません。'); return; }
  shell.countdown.textContent = remainingTime(remaining);
}
async function initialize() {
  const version = ++loadVersion;
  mode = null; editable = false; closeMenu(); shell = null;
  app.setAttribute('aria-busy', 'true'); app.replaceChildren(element('p', 'Binderを読み込み中…', 'loading'));
  try {
    const loaded = await api<BinderData>(endpoint);
    let accessError = '';
    if (editing) {
      try { await api(`${endpoint}/access`); }
      catch (error) { accessError = error instanceof Error ? error.message : '編集権限を確認できませんでした。再読み込みしてお試しください。'; }
    }
    if (version !== loadVersion) return;
    data = loaded; editable = editing && !accessError;
    shell = mountBinder(); renderLocation(); updateExpiry();
    if (accessError && shell) {
      feedback(shell.notice, accessError, true);
      shell.notice.append(button('再試行', () => void initialize(), 'text-button'));
    }
  } catch (error) {
    if (version === loadVersion) { data = null; unavailable(error instanceof Error ? error.message : 'Binderを読み込めませんでした。接続を確認してお試しください。'); }
  } finally { if (version === loadVersion) app.setAttribute('aria-busy', 'false'); }
}
function landing() {
  const section = element('section', undefined, 'landing');
  section.append(element('h1', 'リンクをまとめて、一時的に共有。'), element('p', 'フォルダーに整理して、ひとつのURLで渡せます。', 'muted'));
  const message = notice();
  section.append(button('Binderを作成', () => void (async () => {
    await perform(async () => {
      const binder = await api<{ id: string; edit_token: string }>('/api/binders', 'POST', {});
      location.assign(`/b/${binder.id}/edit#${binder.edit_token}`);
    }, message);
  })(), 'primary'));
  section.append(element('p', 'アカウント不要。作成から7日後に自動削除されます。', 'footnote'), message); app.replaceChildren(section);
  app.setAttribute('aria-busy', 'false');
}
window.addEventListener('popstate', () => { if (shell) navigate(currentFolder(), false); });
window.addEventListener('hashchange', () => { token = editing ? location.hash.slice(1) : ''; if (id) void initialize(); });
window.addEventListener('resize', () => closeMenu());
setInterval(updateExpiry, 1000);
if (id) void initialize();
else if (location.pathname === '/') landing();
else { app.replaceChildren(element('h1', 'ページが見つかりません')); app.setAttribute('aria-busy', 'false'); }
