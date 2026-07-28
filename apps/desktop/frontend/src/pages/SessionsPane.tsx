/**
 * SessionsPane.tsx — Componente SolidJS para la lista de sesiones
 * dentro de un panel. Wrapper sobre SessionsPage.
 */
import { SessionsPage } from './SessionsPage.tsx';
import type { TabId, PaneId } from 'xi-ui/lib/state.ts';

export function SessionsPane(props: { tabId?: TabId | string; paneId?: PaneId | string }) {
  return <SessionsPage tabId={props.tabId} paneId={props.paneId} />;
}
