/**
 * PaneView.tsx — Renderiza un panel individual segun su tipo.
 * Usa <Dynamic> de SolidJS para renderizar el componente correspondiente.
 */
import { type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { Pane, PaneType } from '../lib/panel-manager.ts';
import type { TabId, PaneId, SessionPath } from 'xi-ui/lib/state.ts';

// Mapa: PaneType -> Componente SolidJS.
const PANE_COMPONENTS: Record<string, Component<{ tabId?: TabId | string; paneId?: PaneId | string; sessionId?: SessionPath | string }>> = {};

// Labels para la UI (picker de tipos de panel).
const PANE_LABELS: Record<string, string> = {};

export function registerPaneType(
  type: string,
  comp: Component<{ tabId?: TabId | string; paneId?: PaneId | string; sessionId?: SessionPath | string }>,
  label?: string,
): void {
  PANE_COMPONENTS[type] = comp;
  PANE_LABELS[type] = label ?? type;
}

/** Devuelve los tipos de panel registrados con su label (excluye 'chat' y 'sessions'). */
export function getAvailablePaneTypes(): { type: PaneType; label: string }[] {
  return Object.entries(PANE_LABELS)
    .filter(([type]) => type !== 'chat' && type !== 'sessions')
    .map(([type, label]) => ({ type: type as PaneType, label }));
}

function PaneFallback(_props: { tabId?: TabId | string; paneId?: PaneId | string; sessionId?: SessionPath | string }): JSX.Element {
  return <div class="pane-unknown">Panel no disponible</div>;
}

export function PaneView(props: {
  tabId: TabId | string;
  pane: Pane;
  focused: boolean;
  onFocus: (paneId: PaneId | string) => void;
}) {
  const Comp = () => PANE_COMPONENTS[props.pane.type] ?? PaneFallback;
  return (
    <div class="pane" classList={{ 'pane--focused': props.focused }}
         onClick={() => props.onFocus(props.pane.id)}>
      <Dynamic component={Comp()} tabId={props.tabId} paneId={props.pane.id} sessionId={props.pane.sessionId} />
    </div>
  );
}
