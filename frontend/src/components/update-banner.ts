/**
 * update-banner.ts — Banner de update en el top bar (Capa 1: Rendering).
 *
 * Aparece como una franja horizontal DEBAJO del top bar cuando hay
 * un update descargado y verificado esperando relaunch. Es el
 * affordance principal para que el user aplique el update — la
 * sección de settings tiene un botón equivalente, pero el banner
 * es el que el user ve siempre.
 *
 * Por qué no está dentro del header: el header ya tiene 4 zonas
 * apretadas (logo, proyecto, tabs, settings). Una 5ta zona
 * obligatoria lo rompe. Como fila separada del shell, el banner
 * no compite con el header y desaparece limpio cuando no aplica.
 *
 * Estado de visibilidad (single source of truth: appState):
 *   - updateStatus === 'ready'  &&  !updateDismissed  →  visible
 *   - cualquier otro estado                        →  oculto
 *
 * Cero DOM directo al montar: si no hay update, retorna un fragment
 * vacío. main.ts lo appenda al slot #update-banner del shell y listo.
 */

import { appState } from '../lib/state.ts';
import {
  installAndRelaunch,
  dismissBanner,
} from '../lib/updater.ts';

export function UpdateBanner(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const banner = document.createElement('div');
  banner.className = 'update-banner';

  const text = document.createElement('span');
  text.className = 'update-banner-text';
  banner.append(text);

  const restartBtn = document.createElement('button');
  restartBtn.className = 'update-banner-restart';
  restartBtn.textContent = 'Reiniciar para aplicar';
  restartBtn.addEventListener('click', () => {
    void installAndRelaunch();
  });
  banner.append(restartBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'update-banner-dismiss';
  dismissBtn.textContent = '×';
  dismissBtn.title = 'Recordar más tarde';
  dismissBtn.addEventListener('click', () => dismissBanner());
  banner.append(dismissBtn);

  // La función de visibilidad encapsula el criterio (banner visible
  // solo si ready y no dismissed). Llamada en mount y en cada cambio
  // de las 3 signals relevantes.
  const update = (): void => {
    const ready = appState.updateStatus.value === 'ready'
      && appState.updateReady.value !== null
      && !appState.updateDismissed.value;
    if (ready) {
      text.textContent = `xi v${appState.updateReady.value!.version} lista para aplicar`;
      banner.classList.add('update-banner--visible');
    } else {
      banner.classList.remove('update-banner--visible');
    }
  };

  update();
  appState.updateStatus.subscribe(update);
  appState.updateReady.subscribe(update);
  appState.updateDismissed.subscribe(update);

  fragment.append(banner);
  return fragment;
}
