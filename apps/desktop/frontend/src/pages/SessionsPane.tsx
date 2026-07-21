/**
 * SessionsPane.tsx — Componente SolidJS para la lista de sesiones
 * dentro de un panel. Wrapper sobre SessionsPage.
 */
import { SessionsPage } from './SessionsPage.tsx';

export function SessionsPane(props: { tabId?: string; paneId?: string }) {
  return <SessionsPage tabId={props.tabId} paneId={props.paneId} />;
}
