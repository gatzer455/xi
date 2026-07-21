/**
 * TileArea.tsx — Renderiza los tiles (splits) de una tab en CSS Grid.
 *
 * Cada tile ocupa una celda del grid según TabLayout. El tile activo
 * tiene un borde resaltado. Click en un tile lo activa.
 */

import { For, onMount, onCleanup, Show } from 'solid-js';
import { getTabs, setActiveTile } from '../lib/tab-manager.ts';
import { ChatPage } from '../pages/ChatPage.tsx';
import { mountExplorer } from '../pages/ExplorerPage.tsx';

/** Renderiza el explorer dentro de un contenedor. */
function TileExplorer() {
  let ref: HTMLDivElement | undefined;
  onMount(() => {
    if (ref) mountExplorer(ref, undefined);
  });
  onCleanup(() => {
    if (ref) ref.replaceChildren();
  });
  return <div ref={ref} class="explorer-page" style={{ height: '100%' }} />;
}

export interface TileAreaProps {
  tabId: string;
}

export function TileArea(props: TileAreaProps) {
  // NOTA: el getter accede a .tiles para que SolidJS trackee cambios
  // via produce(). Sin esto, TabArea no se re-renderiza al hacer split.
  const tab = () => {
    const t = getTabs().find(t => t.id === props.tabId);
    if (t) t.tiles; // ← fuerza tracking de tiles
    return t ?? null;
  };
  const tiles = () => tab()?.tiles ?? [];
  const layout = () => tab()?.layout;
  const activeTileId = () => tab()?.activeTileId;

  const gridStyle = () => {
    const l = layout();
    if (!l || l.direction === null) return {};
    if (l.direction === 'horizontal') {
      return {
        display: 'grid',
        'grid-template-columns': l.sizes.map(s => `${(s * 100).toFixed(1)}fr`).join(' '),
        'grid-template-rows': '1fr',
      };
    }
    return {
      display: 'grid',
      'grid-template-columns': '1fr',
      'grid-template-rows': l.sizes.map(s => `${(s * 100).toFixed(1)}fr`).join(' '),
    };
  };

  return (
    <div class="tile-area" style={gridStyle()}>
      <For each={tiles()}>
        {(tile) => (
          <div classList={{ tile: true, 'tile--active': tile.id === activeTileId() }}
               onClick={() => setActiveTile(props.tabId, tile.id)}>
            <div class="tile-content">
              <Show when={tile.type === 'chat'}>
                <ChatPage sessionId={tile.sessionId} />
              </Show>
              <Show when={tile.type === 'explorer'}>
                <TileExplorer />
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
