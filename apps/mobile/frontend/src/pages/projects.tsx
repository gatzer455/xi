/**
 * projects.tsx — Picker de proyecto (whitelist de xi-serve).
 */
import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { navigate } from 'xi-ui/lib/nav.ts';
import { appState } from 'xi-ui/lib/state.ts';
import { listProjects, startPi } from 'xi-ui/lib/pi/tauri-commands.ts';
import { clearStores } from 'xi-ui/lib/chat/stores.ts';
import { connectionState } from '../lib/connection-state.ts';

export function ProjectsPage() {
  const [projects, setProjects] = createSignal<string[]>([]);
  const [status, setStatus] = createSignal('');
  const [connState, setConnState] = createSignal(connectionState.value);
  const [loading, setLoading] = createSignal(false);

  onCleanup(connectionState.subscribe(setConnState));

  createEffect(async () => {
    if (connState() === 'connected') {
      setStatus('Cargando proyectos…');
      setLoading(true);
      try {
        const p = await listProjects();
        setProjects(p);
        setStatus('');
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    } else {
      setStatus(connState() === 'reconnecting' ? 'Reconectando…' : 'Sin conexión');
      setProjects([]);
    }
  });

  async function openProject(path: string) {
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
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div class="projects-page">
      <h1>Proyectos</h1>
      {status() && <div class="projects-status">{status()}</div>}
      <div class="projects-list">
        <Show when={projects().length === 0 && !loading()} fallback={
          <For each={projects()}>
            {(path) => (
              <button class="project-item" onClick={() => openProject(path)}>
                {path}
              </button>
            )}
          </For>
        }>
          <p>No hay proyectos whitelisteados en el servidor.</p>
        </Show>
      </div>
    </div>
  );
}
