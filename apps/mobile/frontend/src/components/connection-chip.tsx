/**
 * connection-chip.tsx — Chip permanente de estado de conexión.
 */
import { createSignal, onCleanup } from 'solid-js';
import { connectionState, type ConnState } from '../lib/connection-state.ts';

const LABELS: Record<ConnState, string> = {
  connected: '● conectado',
  reconnecting: '● reconectando…',
  offline: '● sin conexión',
};

export function ConnectionChip() {
  const [state, setState] = createSignal(connectionState.value);
  onCleanup(connectionState.subscribe(setState));

  return (
    <div class="conn-chip" data-state={state()}>
      {LABELS[state()]}
    </div>
  );
}
