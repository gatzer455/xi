/**
 * output.ts — Output board del app shell browser-shaped (Capa 1 + Capa 3).
 *
 * Contenido central de la app. Se suscribe a `appState.currentView`
 * y re-renderiza cuando cambia. 4 vistas posibles:
 *
 *   'welcome'   → logo + "Bienvenido a xi" + nombre del proyecto
 *   'chat'      → historial de mensajes (ChatBubble)
 *   'sessions'  → lista de sesiones (rename/delete/switch)
 *   'settings'  → panel de configuración
 *
 * Cada vista se renderiza dentro de .output-content (max-width 1100px,
 * centrado). El scroll vertical lo maneja #output-board (el padre).
 *
 * No incluye el input — el input es parte del shell (input.ts),
 * siempre visible abajo, independiente de la vista activa.
 */

import { appState } from '../lib/state.ts';
import type { Page } from '../lib/scope.ts';
import { ChatPage } from '../pages/chat.ts';
import { ExplorerPage } from '../pages/explorer.ts';
import { SessionsPage } from '../pages/sessions.ts';
import { SettingsPage } from '../pages/settings.ts';
import { WelcomePage } from '../pages/welcome.ts';

export function OutputBoard(): HTMLElement {
  const board = document.createElement('div');
  board.className = 'output-board';

  const content = document.createElement('div');
  content.className = 'output-content';
  board.append(content);

  // Dispose de la vista actualmente montada. Se llama antes de cada
  // `replaceChildren` para limpiar suscripciones, intervals, event
  // listeners, ResizeObservers, etc. Si no se llamara, las pages
  // viejas quedarían vivas en memoria (memory leak) y sus callbacks
  // se dispararían duplicados en cada cambio de signal.
  let currentDispose: (() => void) | null = null;

  const render = (view: typeof appState.currentView.value): void => {
    if (currentDispose) {
      currentDispose();
      currentDispose = null;
    }
    content.replaceChildren();
    let page: Page | null = null;
    switch (view) {
      case 'welcome':
        page = WelcomePage();
        break;
      case 'chat':
        page = ChatPage();
        break;
      case 'sessions':
        page = SessionsPage();
        break;
      case 'explorer':
        page = ExplorerPage();
        break;
      case 'settings':
        page = SettingsPage();
        break;
      default:
        // Exhaustividad: si se agrega una vista nueva y se olvida
        // el case, mostramos un mensaje visible en vez de fallar
        // silenciosamente.
        content.append(unknownView(view));
        return;
    }
    content.append(page.root);
    currentDispose = page.dispose;
  };

  render(appState.currentView.value);
  appState.currentView.subscribe(render);

  return board;
}

function unknownView(view: string): HTMLElement {
  const div = document.createElement('div');
  div.style.cssText = 'padding: var(--space-6); color: var(--color-error);';
  div.textContent = `Vista desconocida: "${view}"`;
  return div;
}
