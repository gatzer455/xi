/**
 * sessions.tsx — Lista de sesiones del proyecto activo.
 *
 * Versión simplificada de apps/desktop/frontend/src/pages/sessions.ts:
 * sin rename/delete/polling — MVP mobile solo necesita listar, abrir
 * y crear (ponytail: agregar rename/delete cuando el uso diario lo pida).
 */
import { createSignal, For, Show, onMount } from 'solid-js';
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

export function SessionsPage() {
  const [sessions, setSessions] = createSignal<SessionInfo[]>([]);
  const [status, setStatus] = createSignal('');

  const wd = appState.workingDir.value;
  const projectName = wd ? (wd.split('/').filter(Boolean).pop() ?? wd) : 'Sesiones';

  onMount(() => { void load(); });

  async function load() {
    const cwd = appState.workingDir.value;
    if (!cwd) return;
    setStatus('Cargando…');
    try {
      const result = await listSessions(cwd);
      setSessions(result.sessions);
      setStatus('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function createNewTab() {
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
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function openExisting(session: SessionInfo) {
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
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
    navigate('chat');
  }

  return (
    <div class="sessions-page">
      <header class="sessions-header">
        <h1>{projectName}</h1>
        <button class="back-btn" onClick={() => navigate('projects')}>
          ← Proyectos
        </button>
        <button class="sessions-new" onClick={() => createNewTab()}>
          + Nueva conversación
        </button>
      </header>
      {status() && <div class="sessions-status">{status()}</div>}
      <div class="sessions-list">
        <Show when={sessions().length > 0} fallback={
          <p>No hay sesiones en este proyecto.</p>
        }>
          <For each={sessions()}>
            {(session) => (
              <button class="session-item" onClick={() => openExisting(session)}>
                <div class="session-item-name">
                  {session.name || new Date(session.created).toLocaleString('es-CL')}
                </div>
                <div class="session-item-preview">
                  {session.messageCount === 0
                    ? '(sin mensajes)'
                    : session.firstMessage.length > 100
                      ? session.firstMessage.slice(0, 100) + '…'
                      : session.firstMessage}
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
