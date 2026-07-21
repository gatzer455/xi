/**
 * PaneRoot.tsx — Grid de paneles para una tab.
 *
 * Renderiza un CSS Grid con los paneles de la tab según la cantidad.
 * Layout determinístico (ver PLAN.md sección 1):
 *   1 → [ A ]
 *   2 → [ A | B ]
 *   3 → [ A | B ]   (A ocupa 2 filas)
 *        [   | C ]
 *   4 → [ A | B ]
 *        [ D | C ]
 */
import { For } from 'solid-js';
import { getTabs, setFocus } from '../lib/panel-manager.ts';
import { PaneView } from './PaneView.tsx';

export function PaneRoot(props: { tabId: string }) {
  const tab = () => getTabs().find(t => t.id === props.tabId);
  const panes = () => tab()?.panes ?? [];
  const focus = () => tab()?.focus ?? '';
  const count = () => panes().length;

  return (
    <div class="pane-root" data-panes={count()} data-multi={count() > 1 ? '' : undefined}>
      <For each={panes()}>
        {(pane) => (
          <PaneView pane={pane}
                    focused={pane.id === focus()}
                    onFocus={(paneId) => setFocus(props.tabId, paneId)} />
        )}
      </For>
    </div>
  );
}
