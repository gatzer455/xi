/**
 * OutputBoard.tsx — Enrutador de páginas del app shell.
 */
import { createSignal, Switch, Match, onMount, onCleanup } from 'solid-js';
import { appState, type ViewName } from 'xi-ui/lib/state.ts';
import type { Page } from 'xi-ui/lib/scope.ts';
import { getActiveTab, getActiveTabId } from '../lib/tab-manager.ts';
import { ChatPage } from '../pages/ChatPage.tsx';
import { explorerPageFactory as ExplorerPage } from '../pages/ExplorerPage.tsx';
import { SessionsPage } from '../pages/SessionsPage.tsx';
import { SettingsPage } from '../pages/SettingsPage.tsx';
import { WelcomePage } from '../pages/WelcomePage.tsx';
import { TileArea } from './TileArea.tsx';

/** Envuelve una página vanilla (interfaz Page) como componente SolidJS. */
function VanillaPage(props: { factory: () => Page }) {
  let ref: HTMLDivElement | undefined;
  onMount(() => {
    if (!ref) return;
    const page = props.factory();
    ref.append(page.root);
    onCleanup(() => page.dispose());
  });
  return <div ref={ref} />;
}

export function OutputBoard() {
  const [view, setView] = createSignal<ViewName>(appState.currentView.value);
  const [hasTiles, setHasTiles] = createSignal(false);

  onMount(() => {
    onCleanup(appState.currentView.subscribe((v) => setView(v)));
  });

  // Detectar si la tab activa tiene múltiples tiles
  onMount(() => {
    function checkTiles() {
      const tab = getActiveTab();
      setHasTiles(!!tab && tab.tiles.length > 1);
    }
    checkTiles();
    // Polling para detectar cambios de tiles (creates/tiles cambian)
    const iv = setInterval(checkTiles, 100);
    onCleanup(() => clearInterval(iv));
  });

  return (
    <div class="output-board">
      <div class="output-content">
        <Switch fallback={<div class="output-error">Vista desconocida: "{view()}"</div>}>
          <Match when={hasTiles() && getActiveTabId()}>
            <TileArea tabId={getActiveTabId()!} />
          </Match>
          <Match when={view() === 'welcome'}><WelcomePage /></Match>
          <Match when={view() === 'chat'}><ChatPage /></Match>
          <Match when={view() === 'sessions'}><SessionsPage /></Match>
          <Match when={view() === 'explorer'}><VanillaPage factory={ExplorerPage} /></Match>
          <Match when={view() === 'settings'}><SettingsPage /></Match>
        </Switch>
      </div>
    </div>
  );
}
