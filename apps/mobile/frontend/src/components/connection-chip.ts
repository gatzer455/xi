/**
 * connection-chip.ts — Chip permanente de estado de conexión.
 *
 * "conectado / reconectando / sin conexión", alimentado por
 * connectionState (ver docs/mobile/04-cliente-movil.md § Adaptaciones).
 */
import { connectionState, type ConnState } from '../lib/connection-state.ts';

const LABELS: Record<ConnState, string> = {
  connected: '● conectado',
  reconnecting: '● reconectando…',
  offline: '● sin conexión',
};

export function ConnectionChip(): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'conn-chip';

  const paint = (state: ConnState) => {
    chip.textContent = LABELS[state];
    chip.dataset.state = state;
  };

  connectionState.subscribe(paint);
  return chip;
}
