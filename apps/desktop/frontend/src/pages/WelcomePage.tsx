/**
 * WelcomePage.tsx — Pantalla de bienvenida y proyectos recientes.
 */
import { createSignal, For, Show, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { pickAndOpenProject, openProject } from '../lib/workdir.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { getRecents } from '../lib/pi/index.ts';
import type { Recent } from '../lib/pi/index.ts';
import { loadAuthStatus } from '../lib/auth-status.ts';

export function WelcomePage() {
  void loadAuthStatus();
  const [error, setError] = createSignal<string | null>(null);

  // Navegar a sessions cuando cambia workingDir
  const initialDir = appState.workingDir.value;
  onCleanup(appState.workingDir.subscribe((dir) => {
    if (dir && dir !== initialDir) navigate('sessions');
  }));

  return (
    <div class="welcome-page">
      <div class="welcome-error" style={{ display: error() ? 'flex' : 'none' }}>
        {error()}
      </div>

      <div class="welcome-header">
        <img class="welcome-icon" src="xi-icon.svg" alt="Xi" />
        <p class="welcome-subtitle">
          Xi es un asistente de inteligencia artificial. Abre un proyecto y pídele lo que necesites:
          redactar documentos, analizar archivos, responder preguntas, lo que necesites.
        </p>
      </div>

      <AuthBanner />

      <button class="welcome-cta" onClick={pickAndOpenProject}>
        Selecciona una carpeta primero
      </button>

      <RecentsSection />
    </div>
  );
}

function AuthBanner() {
  const [hidden, setHidden] = createSignal(appState.hasAnyProvider.value);
  onCleanup(appState.hasAnyProvider.subscribe((v) => setHidden(v)));

  return (
    <div class="welcome-auth-banner" style={{ visibility: hidden() ? 'hidden' : 'visible' }}>
      <span>⚠ No hay modelo configurado. Configurá tu API key para empezar.</span>
      <button class="welcome-auth-banner-btn" onClick={() => navigate('settings')}>
        Ir a Configuración
      </button>
    </div>
  );
}

function RecentsSection() {
  const [recents, setRecents] = createSignal<Recent[]>([]);

  // Bridge: vanilla signal → SolidJS
  onCleanup(appState.recents.subscribe((r) => setRecents(r)));

  // Cargar recents si no hay
  if (appState.recents.value.length === 0) {
    getRecents().then((r) => { appState.recents.value = r; }).catch(console.error);
  }

  return (
    <Show when={recents().length > 0}>
      <div class="welcome-recents">
        <h2 class="welcome-recents-title">O abre un proyecto reciente</h2>
        <div class="recents-grid">
          <For each={recents()}>
            {(r) => <RecentCard recent={r} />}
          </For>
        </div>
      </div>
    </Show>
  );
}

function RecentCard(props: { recent: Recent }) {
  return (
    <button class="recent-card" data-path={props.recent.path}
            onClick={() => openProject(props.recent.path)}>
      <div class="recent-name">{props.recent.name}</div>
      <div class="recent-path" title={props.recent.path}>
        {truncatePath(props.recent.path)}
      </div>
      <div class="recent-time">{formatRelativeTime(props.recent.lastOpened)}</div>
    </button>
  );
}

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} día${days > 1 ? 's' : ''}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `hace ${weeks} sem`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

function truncatePath(fullPath: string, maxLen = 40): string {
  if (fullPath.length <= maxLen) return fullPath;
  return '…' + fullPath.slice(-(maxLen - 1));
}
