/**
 * OutputBoard.tsx — Enrutador de páginas del app shell.
 */
import { createSignal, Switch, Match, onMount, onCleanup } from 'solid-js';
import { appState, type ViewName } from 'xi-ui/lib/state.ts';
import { getActiveTabId } from '../lib/panel-manager.ts';
import { SettingsPage } from '../pages/SettingsPage.tsx';
import { WelcomePage } from '../pages/WelcomePage.tsx';
import { PaneRoot } from './PaneRoot.tsx';

/** 
 * OutputBoard.tsx — Enrutador del app shell.
 * 
 * Cuando hay tabs activas (proyecto abierto), renderiza PaneRoot para
 * todos los tipos de pane (chat, sessions, explorer).
 * Sin proyecto: WelcomePage. Settings: full page siempre.
 */

export function OutputBoard() {
  const [view, setView] = createSignal<ViewName>(appState.currentView.value);

  onMount(() => {
    onCleanup(appState.currentView.subscribe((v) => setView(v)));
  });

  return (
    <div class="output-board">
      <div class="output-content">
        <Switch fallback={<div class="output-error">Vista desconocida: "{view()}"</div>}>
          <Match when={view() === 'settings'}><SettingsPage /></Match>
          <Match when={view() === 'welcome'}><WelcomePage /></Match>
          <Match when={getActiveTabId()}>
            <PaneRoot tabId={getActiveTabId()!} />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
