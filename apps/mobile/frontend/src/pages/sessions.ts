/**
 * sessions.ts — Lista de sesiones del proyecto activo.
 *
 * Versión simplificada de apps/desktop/frontend/src/pages/sessions.ts:
 * sin rename/delete/polling — MVP mobile solo necesita listar, abrir
 * y crear (ver docs/mobile/06-roadmap-mvp.md § Fase 3).
 * ponytail: agregar rename/delete cuando el uso diario lo pida.
 */
import { createScope, type Page } from 'xi-ui/lib/scope.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { appState, setActiveTab, type Session } from 'xi-ui/lib/state.ts';
import {
  listSessions,
  openSession,
  newPiSession,
  getPiState,
  getPiMessages,
  getAvailableModels,
} from 'xi-ui/lib/pi/tauri-commands.ts';
import type { SessionInfo } from 'xi-ui/lib/pi/types.ts';

export function SessionsPage(): Page {
  const root = document.createElement('div');
  root.className = 'sessions-page';
  const scope = createScope();

  const header = document.createElement('header');
  header.className = 'sessions-header';
  const title = document.createElement('h1');
  title.textContent = appState.workingDir.value ?? 'Sesiones';
  header.append(title);

  const backBtn = document.createElement('button');
  backBtn.textContent = '← Proyectos';
  backBtn.addEventListener('click', () => navigate('projects'));
  header.append(backBtn);

  const newBtn = document.createElement('button');
  newBtn.className = 'sessions-new';
  newBtn.textContent = '+ Nueva conversación';
  newBtn.addEventListener('click', () => void createNewTab());
  header.append(newBtn);

  root.append(header);

  const status = document.createElement('div');
  status.className = 'sessions-status';
  root.append(status);

  const list = document.createElement('div');
  list.className = 'sessions-list';
  root.append(list);

  void load();

  async function load(): Promise<void> {
    const cwd = appState.workingDir.value;
    if (!cwd) return;
    status.textContent = 'Cargando…';
    try {
      const result = await listSessions(cwd);
      status.textContent = '';
      renderList(result.sessions);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  function renderList(sessions: SessionInfo[]): void {
    list.replaceChildren();
    if (sessions.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No hay sesiones en este proyecto.';
      list.append(empty);
      return;
    }
    for (const session of sessions) {
      const item = document.createElement('button');
      item.className = 'session-item';
      const name = document.createElement('div');
      name.className = 'session-item-name';
      name.textContent = session.name || new Date(session.created).toLocaleString('es-CL');
      const preview = document.createElement('div');
      preview.className = 'session-item-preview';
      preview.textContent = session.messageCount === 0
        ? '(sin mensajes)'
        : truncate(session.firstMessage, 100);
      item.append(name, preview);
      item.addEventListener('click', () => void openExisting(session));
      list.append(item);
    }
  }

  async function createNewTab(): Promise<void> {
    const tabId = crypto.randomUUID();
    const newTab: Session = { id: tabId, messageCount: 0 };
    setActiveTab(tabId);
    appState.openTabs.value = [...appState.openTabs.value, newTab];
    navigate('chat');
    try {
      await newPiSession();
      await getPiState();
      getAvailableModels();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  async function openExisting(session: SessionInfo): Promise<void> {
    const isOpen = appState.openTabs.value.some((t) => t.id === session.id);
    if (isOpen) {
      setActiveTab(session.id);
      navigate('chat');
      return;
    }
    const newTab: Session = {
      id: session.id,
      name: session.name,
      file: session.path,
      messageCount: session.messageCount,
    };
    setActiveTab(session.id);
    appState.openTabs.value = [...appState.openTabs.value, newTab];
    try {
      await openSession(session.path);
      await getPiState();
      await getPiMessages();
      getAvailableModels();
      navigate('chat');
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
      navigate('chat');
    }
  }

  return { root, dispose: () => scope.dispose() };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
