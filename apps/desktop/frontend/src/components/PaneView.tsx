/**
 * PaneView.tsx — Renderiza un panel individual segun su tipo.
 * Usa <Dynamic> de SolidJS para renderizar el componente correspondiente.
 */
import { type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { Pane } from '../lib/panel-manager.ts';

// Mapa: PaneType -> Componente SolidJS.
// Props tipadas: tabId (para pane-sessions), paneId (ID del panel), sessionId (para chat)
const PANE_COMPONENTS: Record<string, Component<{ tabId?: string; paneId?: string; sessionId?: string }>> = {};

export function registerPaneType(type: string, comp: Component<{ tabId?: string; paneId?: string; sessionId?: string }>): void {
  PANE_COMPONENTS[type] = comp;
}

function PaneFallback(_props: { tabId?: string; paneId?: string; sessionId?: string }): JSX.Element {
  return <div class="pane-unknown">Panel no disponible</div>;
}

export function PaneView(props: {
  tabId: string;
  pane: Pane;
  focused: boolean;
  onFocus: (paneId: string) => void;
}) {
  const Comp = () => PANE_COMPONENTS[props.pane.type] ?? PaneFallback;
  return (
    <div class="pane" classList={{ 'pane--focused': props.focused }}
         onClick={() => props.onFocus(props.pane.id)}>
      <Dynamic component={Comp()} tabId={props.tabId} paneId={props.pane.id} sessionId={props.pane.sessionId} />
    </div>
  );
}
