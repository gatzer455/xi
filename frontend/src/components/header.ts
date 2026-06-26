/**
 * header.ts — Top bar del app shell browser-shaped (Capa 1: Rendering).
 *
 * Barra horizontal de 48px con 4 zonas:
 *   [logo xi] [card proyecto ▾] [tabs...] [⚙ Settings]
 *
 * - Logo: PNG de 28×28 desde /xi.png (public/).
 * - Card proyecto: muestra el nombre de la carpeta actual. Click →
 *   abre el selector nativo de carpetas (pickAndOpenProject).
 * - Tabs: una tab por cada sesión abierta en `appState.openTabs`.
 *   Click → setActiveTab (carga mensajes de esa tab, navega a chat).
 *   Botón × cierra la tab (la quita de openTabs). El botón "+" al
 *   final abre la vista de sesiones (historial) para crear/elegir.
 * - Settings: icono ⚙ + texto. Click → vista de settings.
 *
 * Navegación con `navigate(view)` o `setActiveTab(id)` de nav/state.
 * No hay router hash-based.
 */

import { appState, setActiveTab, type Session } from '../lib/state.ts';
import { navigate } from '../lib/nav.ts';
import { pickAndOpenProject } from '../lib/workdir.ts';
import { dropStore } from '../lib/chat/stores.ts';
import { icon } from '../lib/icons.ts';

export function Header(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'top-bar';

  bar.append(renderLogo());
  bar.append(renderProjectCard());
  bar.append(renderTabs());
  bar.append(renderSettings());

  return bar;
}

// ───────────────────────────────────────────────────────
// Zonas
// ───────────────────────────────────────────────────────

function renderLogo(): HTMLElement {
  const img = document.createElement('img');
  img.className = 'top-bar-logo';
  img.src = '/xi-icon.svg';
  img.alt = 'xi';
  img.width = 28;
  img.height = 28;
  img.style.cursor = 'pointer';
  img.title = 'Inicio';
  img.addEventListener('click', () => navigate('welcome'));
  return img;
}

function renderProjectCard(): HTMLElement {
  const card = document.createElement('button');
  card.className = 'top-bar-project';
  card.title = 'Cambiar de proyecto';

  const paint = (dir: string | null): void => {
    if (dir) {
      card.textContent = dir.split('/').pop() || dir;
      card.title = dir;
    } else {
      card.textContent = 'Seleccionar proyecto';
      card.title = 'Haz click para seleccionar una carpeta de trabajo';
    }
  };

  paint(appState.workingDir.value);
  appState.workingDir.subscribe(paint);

  card.addEventListener('click', () => {
    pickAndOpenProject().catch((err) => {
      console.error('Error opening folder:', err);
    });
  });

  return card;
}

function renderTabs(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'top-bar-tabs';

  const repaint = (): void => {
    container.replaceChildren();
    const tabs = appState.openTabs.value;
    const activeId = appState.activeTabId.value;

    for (const tab of tabs) {
      container.append(renderTab(tab, activeId === tab.id));
    }

    // Botón "+" al final de los tabs — va a la vista de sesiones
    // (historial) para elegir o crear una nueva conversación.
    // Solo visible si hay una sesión activa (no en welcome ni sessions vacío).
    if (tabs.length > 0) {
      const newBtn = document.createElement('button');
      newBtn.className = 'top-bar-new-btn';
      newBtn.append(icon('message-square-plus', { size: 16 }));
      newBtn.title = 'Ver historial de conversaciones';
      newBtn.addEventListener('click', () => navigate('sessions'));
      container.append(newBtn);

      // Botón para el explorador de archivos.
      // Solo visible si hay un proyecto abierto.
      if (appState.workingDir.value) {
        const explorerBtn = document.createElement('button');
        explorerBtn.className = 'top-bar-new-btn';
        explorerBtn.append(icon('folder-tree', { size: 16 }));
        explorerBtn.title = 'Explorador de archivos';
        explorerBtn.addEventListener('click', () => navigate('explorer'));
        container.append(explorerBtn);
      }
    }
  };

  repaint();
  appState.openTabs.subscribe(repaint);
  appState.activeTabId.subscribe(repaint);

  return container;
}

/** Renderiza una tab individual con nombre + botón de cerrar. */
function renderTab(tab: Session, isActive: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'top-bar-tab' + (isActive ? ' top-bar-tab--active' : '');

  // ── Label (click = switch a esta tab) ──
  const label = document.createElement('button');
  label.className = 'top-bar-tab-label';
  const name = tab.name ?? tabDisplayName(tab);
  label.textContent = name;
  label.title = tab.file ?? name;
  label.addEventListener('click', () => {
    setActiveTab(tab.id);
    navigate('chat');
  });
  el.append(label);

  // ── Close button (×) ──
  const close = document.createElement('button');
  close.className = 'top-bar-tab-close';
  close.textContent = '×';
  close.title = 'Cerrar tab';
  close.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeTab(tab.id);
  });
  el.append(close);

  return el;
}

/**
 * Cierra una tab: la quita de openTabs. Si era la activa, activa
 * la siguiente o la anterior (o ninguna si era la última).
 * También limpia los mensajes guardados de esa tab.
 */
function closeTab(tabId: string): void {
  const tabs = appState.openTabs.value;
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  const wasActive = appState.activeTabId.value === tabId;
  const newTabs = tabs.filter(t => t.id !== tabId);
  appState.openTabs.value = newTabs;

  // Limpiar el ChatStore de la tab cerrada (messages viven en stores).
  dropStore(tabId);

  if (wasActive) {
    // Activar la siguiente tab, o la anterior, o null
    const nextId = newTabs[idx]?.id ?? newTabs[idx - 1]?.id ?? null;
    if (nextId) {
      setActiveTab(nextId);
      navigate('chat');
    } else {
      // No quedan tabs. Ir a sessions para que el usuario cree
      // una nueva sesión. No a welcome — workingDir sigue activo.
      setActiveTab(null);
      appState.session.value = null;
      navigate('sessions');
    }
  }
}

function renderSettings(): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'top-bar-settings';

  const iconEl = icon('settings', { size: 16 });
  iconEl.setAttribute('class', 'top-bar-settings-icon');
  btn.append(iconEl);

  const label = document.createElement('span');
  label.textContent = 'Settings';
  btn.append(label);

  const paintActive = (view: typeof appState.currentView.value): void => {
    btn.classList.toggle('top-bar-settings--active', view === 'settings');
  };
  paintActive(appState.currentView.value);
  appState.currentView.subscribe(paintActive);

  btn.addEventListener('click', () => navigate('settings'));

  return btn;
}

// ───────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────

/** Nombre legible para una sesión sin name custom (usa el basename del file). */
function tabDisplayName(session: { file?: string; id: string }): string {
  if (session.file) {
    const basename = session.file.split('/').pop() ?? 'sesión';
    return basename.replace(/\.jsonl$/, '');
  }
  return session.id.slice(0, 8);
}
