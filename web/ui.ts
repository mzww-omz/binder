export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(text: string, action: () => void, className = '') {
  const node = element('button', text, className);
  node.type = 'button'; node.onclick = action;
  return node;
}
export function icon(kind: 'folder' | 'link' | 'more') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon', `icon-${kind}`);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', {
    folder: 'M2 5a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v9H2Z',
    link: 'M8 12l4-4M7 7l1.5-1.5a4 4 0 0 1 6 6L13 13M7 7l-1.5 1.5a4 4 0 0 0 6 6L13 13',
    more: 'M4 10h.01M10 10h.01M16 10h.01',
  }[kind]);
  svg.append(path);
  return svg;
}
export function iconButton(label: string, kind: 'more', action: () => void) {
  const node = button('', action, 'icon-button');
  node.setAttribute('aria-label', label); node.title = label; node.append(icon(kind));
  return node;
}

interface MenuAction { label: string; action: () => void; disabled?: boolean; danger?: boolean }
let activeMenu: { node: HTMLElement; trigger: HTMLElement } | null = null;
export function closeMenu(restoreFocus = false) {
  if (!activeMenu) return;
  const { node, trigger } = activeMenu;
  activeMenu = null;
  trigger.setAttribute('aria-expanded', 'false');
  node.hidePopover(); node.remove();
  if (restoreFocus) trigger.focus();
}
export function showMenu(trigger: HTMLElement, actions: (MenuAction | null)[], point?: { x: number; y: number }) {
  closeMenu();
  const menu = element('div', undefined, 'context-menu');
  menu.popover = 'auto'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Actions');
  for (const item of actions) {
    if (!item) { menu.append(element('hr')); continue; }
    const entry = button(item.label, () => { closeMenu(); item.action(); }, item.danger ? 'danger-text' : '');
    entry.setAttribute('role', 'menuitem'); entry.tabIndex = -1; entry.disabled = !!item.disabled;
    menu.append(entry);
  }
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'true');
  document.body.append(menu); activeMenu = { node: menu, trigger }; menu.showPopover();
  const anchor = trigger.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
  const x = point?.x ?? anchor.right - bounds.width, y = point?.y ?? anchor.bottom + 4;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
  const entries = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  entries[0]?.focus();
  menu.onkeydown = event => {
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      entries[next]?.focus();
    } else if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    else if (event.key === 'Tab') closeMenu(true);
  };
  menu.addEventListener('toggle', event => {
    if ((event as ToggleEvent).newState === 'closed' && activeMenu?.node === menu) {
      trigger.setAttribute('aria-expanded', 'false'); activeMenu = null; menu.remove();
    }
  });
}
