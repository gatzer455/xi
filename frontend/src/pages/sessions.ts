/**
 * sessions.ts — Página de gestión de sesiones (Etapa 4).
 *
 * Lista las sesiones del cwd activo, permite switch, rename y delete.
 * Hace polling cada 10s para reflejar cambios en el FS.
 *
 * Patrón: signal local + `setInterval` que se limpia en `page:remove`.
 * El polling se pausa si la pestaña no es visible o si hay un input
 * de rename abierto (no pisamos lo que el usuario está escribiendo).
 */

import { signal } from '../lib/signal.ts';
import { appState } from '../lib/state.ts';
import {
  listSessions,
  deleteSession,
  renameSession,
  startPi,
} from '../lib/pi/index.ts';
import type { SessionInfo } from '../lib/pi/types.ts';
import { navigate } from '../router.ts';

const POLL_INTERVAL_MS = 10_000;

// Signals locales: viven mientras la página está montada.
const sessions = signal<SessionInfo[]>([]);
const loading = signal<boolean>(false);
const error = signal<string | null>(null);
/** Path de la sesión cuyo nombre se está editando. null = nadie. */
const renamingPath = signal<string | null>(null);

export function SessionsPage(): HTMLElement {
  const page = document.createElement('section');
  page.className = 'sessions-page';

  page.append(renderHeader());
  page.append(renderErrorBanner());
  page.append(renderList());
  page.append(renderFooter());

  // Carga inicial + polling.
  // Guard de re-entrada: si `loadSessions` ya está en vuelo, el segundo
  // poll no hace nada. Sin esto, dos ticks del interval se solaparían.
  void loadSessions();
  const interval = setInterval(() => {
    void loadSessions();
  }, POLL_INTERVAL_MS);

  // Pausar polling cuando la pestaña no es visible — el usuario no la mira,
  // no tiene sentido gastar CPU. Se reanuda al volver.
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      void loadSessions();
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  // Cleanup: Tauri no llama esto automáticamente. Sin él, el interval
  // y el listener siguen vivos después de navegar a otra página.
  page.addEventListener('page:remove', () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', visibilityHandler);
  });

  return page;
}

// ═══════════════════════════════════════════════════════
// Carga y render
// ═══════════════════════════════════════════════════════

async function loadSessions(): Promise<void> {
  if (loading.value) return;
  if (renamingPath.value !== null) return;

  const cwd = appState.workingDir.value;
  if (!cwd) {
    error.value = 'Selecciona una carpeta de trabajo primero';
    return;
  }

  loading.value = true;
  try {
    sessions.value = await listSessions(cwd);
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function renderHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'sessions-header';

  const title = document.createElement('h1');
  title.textContent = 'Sesiones';
  header.append(title);

  const backBtn = document.createElement('button');
  backBtn.className = 'sessions-back';
  backBtn.textContent = '← Volver al chat';
  backBtn.addEventListener('click', () => navigate('#/chat'));
  header.append(backBtn);

  return header;
}

function renderErrorBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'sessions-error';

  const text = document.createElement('span');
  error.subscribe((e) => {
    text.textContent = e ?? '';
    banner.style.display = e ? 'block' : 'none';
  });
  banner.append(text);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    error.value = null;
  });
  banner.append(closeBtn);

  return banner;
}

function renderList(): HTMLElement {
  const list = document.createElement('div');
  list.className = 'sessions-list';

  const inner = document.createElement('div');
  inner.className = 'sessions-list-inner';

  function repaint(items: SessionInfo[]) {
    inner.replaceChildren();

    if (!appState.workingDir.value) {
      inner.append(emptyState('Selecciona una carpeta de trabajo', '#/'));
      return;
    }
    if (items.length === 0) {
      inner.append(emptyState('No hay sesiones en este proyecto', null));
      return;
    }

    items.forEach((session) => {
      inner.append(renderItem(session));
    });
  }

  sessions.subscribe(repaint);
  repaint(sessions.value);

  list.append(inner);
  return list;
}

function renderFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'sessions-footer';

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = '↻ Refrescar';
  refreshBtn.disabled = false;
  refreshBtn.addEventListener('click', () => {
    void loadSessions();
  });
  footer.append(refreshBtn);

  // Indicador de polling
  const status = document.createElement('span');
  status.className = 'sessions-status';
  status.textContent = 'actualiza cada 10s';
  footer.append(status);

  return footer;
}

// ═══════════════════════════════════════════════════════
// Item de la lista
// ═══════════════════════════════════════════════════════

function renderItem(session: SessionInfo): HTMLElement {
  const item = document.createElement('article');
  item.className = 'session-item';

  const isActive = session.path === appState.session.value?.file;
  if (isActive) item.classList.add('is-active');

  // ── Header del item: nombre + acciones ──
  const header = document.createElement('div');
  header.className = 'session-item-header';

  const nameEl = document.createElement('div');
  nameEl.className = 'session-item-name';
  header.append(nameEl);

  if (isActive) {
    const badge = document.createElement('span');
    badge.className = 'session-badge-active';
    badge.textContent = 'Activa';
    header.append(badge);
  }

  const menuBtn = document.createElement('button');
  menuBtn.className = 'session-item-menu-btn';
  menuBtn.textContent = '⋯';
  menuBtn.title = 'Acciones';
  menuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openMenu(menuBtn, session);
  });
  header.append(menuBtn);

  item.append(header);

  // ── Preview del primer mensaje ──
  const preview = document.createElement('div');
  preview.className = 'session-item-preview';
  preview.textContent =
    session.messageCount === 0
      ? '(sin mensajes)'
      : truncate(session.firstMessage, 120);
  item.append(preview);

  // ── Stats: mensajes + cuándo ──
  const stats = document.createElement('div');
  stats.className = 'session-item-stats';
  const count = document.createElement('span');
  count.textContent = `${session.messageCount} mensajes`;
  stats.append(count);
  const dot = document.createElement('span');
  dot.textContent = ' · ';
  stats.append(dot);
  const when = document.createElement('span');
  when.textContent = timeAgo(session.modified);
  stats.append(when);
  item.append(stats);

  // ── Renderizar el nombre (puede ser <span> o <input> si está en rename) ──
  paintName(nameEl, session);

  // Click en el item (no en el menú) → switch.
  item.addEventListener('click', () => {
    void switchToSession(session);
  });

  return item;
}

function paintName(container: HTMLElement, session: SessionInfo): void {
  container.replaceChildren();

  const isRenaming = renamingPath.value === session.path;

  if (isRenaming) {
    const input = document.createElement('input');
    input.className = 'session-item-name-input';
    input.type = 'text';
    input.value = session.name ?? '';
    input.autofocus = true;
    attachRenameHandlers(input, session, () => {
      renamingPath.value = null;
    });
    container.append(input);
  } else {
    const span = document.createElement('span');
    span.textContent = session.name ?? formatDate(session.created);
    container.append(span);
  }
}

// ═══════════════════════════════════════════════════════
// Menú ⋯ — renombrar / borrar
// ═══════════════════════════════════════════════════════

function openMenu(anchor: HTMLElement, session: SessionInfo): void {
  // Cierra cualquier menú abierto.
  document.querySelectorAll('.session-menu').forEach((el) => el.remove());

  const menu = document.createElement('div');
  menu.className = 'session-menu';

  const renameBtn = document.createElement('button');
  renameBtn.textContent = 'Renombrar';
  renameBtn.addEventListener('click', () => {
    renamingPath.value = session.path;
    menu.remove();
  });
  menu.append(renameBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Borrar';
  deleteBtn.className = 'session-menu-danger';
  deleteBtn.addEventListener('click', () => {
    menu.remove();
    void handleDelete(session);
  });
  menu.append(deleteBtn);

  // Posicionar el menú justo abajo del botón ⋯
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom}px`;
  menu.style.left = `${rect.right - 160}px`;
  document.body.append(menu);

  // Click fuera del menú cierra.
  const onClickOutside = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', onClickOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside), 0);
}

function attachRenameHandlers(
  input: HTMLInputElement,
  session: SessionInfo,
  cancel: () => void,
): void {
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const newName = input.value.trim();
      if (newName === '' || newName === session.name) {
        cancel();
        return;
      }
      void handleRename(session, newName, cancel);
    } else if (ev.key === 'Escape') {
      cancel();
    }
  });
  input.addEventListener('blur', () => {
    // Si el usuario clickeó fuera sin Enter, cancelar.
    if (renamingPath.value === session.path) cancel();
  });
}

// ═══════════════════════════════════════════════════════
// Acciones
// ═══════════════════════════════════════════════════════

async function switchToSession(session: SessionInfo): Promise<void> {
  const cwd = appState.workingDir.value;
  if (!cwd) return;

  loading.value = true;
  try {
    await startPi(cwd, session.path);
    appState.session.value = {
      id: session.id,
      name: session.name,
      file: session.path,
      messageCount: session.messageCount,
    };
    navigate('#/chat');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function handleDelete(session: SessionInfo): Promise<void> {
  if (!confirm('¿Borrar esta sesión?')) return;

  const isActive = session.path === appState.session.value?.file;
  if (isActive && !confirm('Esta es tu sesión activa. Se cerrará. ¿Continuar?')) {
    return;
  }

  try {
    await deleteSession(session.path);
    if (isActive) {
      // Reemplazar la sesión activa con una nueva (sin sessionPath).
      const cwd = appState.workingDir.value;
      if (cwd) await startPi(cwd);
    }
    await loadSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleRename(
  session: SessionInfo,
  newName: string,
  onDone: () => void,
): Promise<void> {
  try {
    await renameSession(session.path, newName);
    onDone();
    await loadSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    onDone();
  }
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function emptyState(message: string, ctaHref: string | null): HTMLElement {
  const div = document.createElement('div');
  div.className = 'sessions-empty';

  const p = document.createElement('p');
  p.textContent = message;
  div.append(p);

  if (ctaHref) {
    const a = document.createElement('a');
    a.href = ctaHref;
    a.textContent = 'Ir al chat';
    div.append(a);
  }
  return div;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDate(unixMs: number): string {
  const d = new Date(unixMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function timeAgo(unixMs: number): string {
  const seconds = Math.floor((Date.now() - unixMs) / 1000);
  if (seconds < 60) return 'hace segundos';
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86_400)} d`;
}
