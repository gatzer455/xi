/**
 * PaneView.tsx — Renderiza un panel individual según su tipo.
 * Usa <Dynamic> de SolidJS para renderizar el componente correspondiente.
 */
import { type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { Pane } from '../lib/panel-manager.ts';

// Mapa: PaneType → Componente SolidJS.
const PANE_COMPONENTS: Record<string, Component<{ paneId?: string; sessionId?: string }>> = {};

export function registerPaneType(type: string, comp: Component<{ paneId?: string; sessionId?: string }>): void {
  PANE_COMPONENTS[type] = comp;
}

function PaneFallback(_props: { paneId?: string; sessionId?: string }): JSX.Element {
  return <div class="pane-unknown">Panel no disponible</div>;
}

export function PaneView(props: {
  pane: Pane;
  focused: boolean;
  onFocus: (paneId: string) => void;
}) {
  const Comp = () => PANE_COMPONENTS[props.pane.type] ?? PaneFallback;
  return (
    <div class="pane" classList={{ 'pane--focused': props.focused }}
         onClick={() => props.onFocus(props.pane.id)}>
      <Dynamic component={Comp()} paneId={props.pane.id} sessionId={props.pane.sessionId} />
    </div>
  );
}
