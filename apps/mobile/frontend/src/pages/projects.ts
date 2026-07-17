/**
 * projects.ts — Picker de proyecto (whitelist de xi-serve).
 *
 * Primera pantalla tras conectar. A diferencia de desktop (picker
 * nativo de carpetas), mobile solo puede abrir proyectos que el
 * usuario ya whitelisteó en `~/.pi/config/xi-serve.json` — no hay
 * filesystem picker en un cliente remoto.
 */
import { createScope, type Page } from 'xi-ui/lib/scope.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { appState } from 'xi-ui/lib/state.ts';
import { listProjects, startPi } from 'xi-ui/lib/pi/tauri-commands.ts';
import { clearStores } from 'xi-ui/lib/chat/stores.ts';
import { connectionState } from '../lib/connection-state.ts';

export function ProjectsPage(): Page {
  const root = document.createElement('div');
  root.className = 'projects-page';
  const scope = createScope();

  const title = document.createElement('h1');
  title.textContent = 'Proyectos';
  root.append(title);

  const status = document.createElement('div');
  status.className = 'projects-status';
  root.append(status);

  const list = document.createElement('div');
  list.className = 'projects-list';
  root.append(list);

  scope.add(connectionState.subscribe((state) => {
    if (state === 'connected') {
      void load();
    } else {
      status.textContent = state === 'reconnecting' ? 'Reconectando…' : 'Sin conexión';
      list.replaceChildren();
    }
  }));

  async function load(): Promise<void> {
    status.textContent = 'Cargando proyectos…';
    try {
      const projects = await listProjects();
      status.textContent = '';
      renderList(projects);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  function renderList(projects: string[]): void {
    list.replaceChildren();
    if (projects.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No hay proyectos whitelisteados en el servidor.';
      list.append(empty);
      return;
    }
    for (const path of projects) {
      const item = document.createElement('button');
      item.className = 'project-item';
      item.textContent = path;
      item.addEventListener('click', () => void openProject(path));
      list.append(item);
    }
  }

  async function openProject(path: string): Promise<void> {
    if (appState.workingDir.value === path) {
      navigate('sessions');
      return;
    }
    appState.openTabs.value = [];
    appState.activeTabId.value = null;
    appState.session.value = null;
    clearStores();
    try {
      await startPi(path);
      appState.workingDir.value = path;
      navigate('sessions');
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  return { root, dispose: () => scope.dispose() };
}
