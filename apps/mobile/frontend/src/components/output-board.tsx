/**
 * output-board.tsx — Renderiza la vista activa (5 vistas mobile).
 */
import { createSignal, Switch, Match, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { ConnectPage } from '../pages/connect';
import { ProjectsPage } from '../pages/projects';
import { SessionsPage } from '../pages/sessions';
import { ChatPage } from '../pages/chat';
import { ExplorerPage } from '../pages/explorer';

export function OutputBoard() {
  const [view, setView] = createSignal(appState.currentView.value);
  onCleanup(appState.currentView.subscribe(setView));

  return (
    <Switch fallback={
      <div style={{ padding: 'var(--space-6)', color: 'var(--color-error)' }}>
        Vista desconocida: "{view()}"
      </div>
    }>
      <Match when={view() === 'connect'}><ConnectPage /></Match>
      <Match when={view() === 'projects'}><ProjectsPage /></Match>
      <Match when={view() === 'sessions'}><SessionsPage /></Match>
      <Match when={view() === 'chat'}><ChatPage /></Match>
      <Match when={view() === 'explorer'}><ExplorerPage /></Match>
    </Switch>
  );
}
