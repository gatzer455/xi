/**
 * output-board.ts — Monta la vista activa (equivalente mobile de
 * apps/desktop/frontend/src/components/output.ts).
 *
 * 5 vistas: connect, projects, sessions, chat, explorer. 'welcome' y
 * 'settings' (ViewName las incluye para desktop) nunca se navegan acá.
 */
import { appState } from 'xi-ui/lib/state.ts';
import type { Page } from 'xi-ui/lib/scope.ts';
import { ConnectPage } from '../pages/connect.ts';
import { ProjectsPage } from '../pages/projects.ts';
import { SessionsPage } from '../pages/sessions.ts';
import { ChatPage } from '../pages/chat.ts';
import { ExplorerPage } from '../pages/explorer.ts';

export function OutputBoard(): HTMLElement {
  const board = document.createElement('div');
  board.className = 'output-board';

  let currentDispose: (() => void) | null = null;

  const render = (view: typeof appState.currentView.value): void => {
    if (currentDispose) {
      currentDispose();
      currentDispose = null;
    }
    board.replaceChildren();
    let page: Page | null = null;
    switch (view) {
      case 'connect':
        page = ConnectPage();
        break;
      case 'projects':
        page = ProjectsPage();
        break;
      case 'sessions':
        page = SessionsPage();
        break;
      case 'chat':
        page = ChatPage();
        break;
      case 'explorer':
        page = ExplorerPage();
        break;
      default:
        board.append(unknownView(view));
        return;
    }
    board.append(page.root);
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
