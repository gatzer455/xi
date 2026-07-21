/**
 * UpdateBanner.tsx — Banner de update en el top bar (SolidJS).
 *
 * Aparece como una franja horizontal debajo del header cuando hay
 * un update descargado listo para aplicar.
 *
 * Bridge entre signals legacy (appState) y reactividad de SolidJS.
 * Se monta via render() en main.tsx → document.getElementById('update-banner').
 */

import { createSignal, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { installAndRelaunch, dismissBanner } from '../lib/updater.ts';

export function UpdateBanner() {
  const [ready, setReady] = createSignal(false);
  const [version, setVersion] = createSignal('');

  function sync() {
    const isReady = appState.updateStatus.value === 'ready'
      && appState.updateReady.value !== null
      && !appState.updateDismissed.value;
    setReady(isReady);
    if (appState.updateReady.value) {
      setVersion(appState.updateReady.value.version);
    }
  }

  // Sincronizar from signals legacy → SolidJS reactivity
  sync();
  const unsub1 = appState.updateStatus.subscribe(sync);
  const unsub2 = appState.updateReady.subscribe(sync);
  const unsub3 = appState.updateDismissed.subscribe(sync);
  onCleanup(() => { unsub1(); unsub2(); unsub3(); });

  return (
    <div class="update-banner" classList={{ 'update-banner--visible': ready() }}>
      <span class="update-banner-text">
        xi v{version()} lista para aplicar
      </span>
      <button class="update-banner-restart" onClick={() => void installAndRelaunch()}>
        Reiniciar para aplicar
      </button>
      <button class="update-banner-dismiss" onClick={() => dismissBanner()}>
        ×
      </button>
    </div>
  );
}
