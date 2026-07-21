/**
 * SplitView.tsx — Renderiza recursivamente un árbol TileNode.
 *
 * Cada hoja es un tile independiente (ChatPage o ExplorerPage)
 * con su propio scroll. El árbol se recorre con flexbox:
 * los splits usan flexDirection + flex ratio para repartir espacio.
 */
import { Show, onMount, onCleanup } from 'solid-js';
import type { TileNode } from '../lib/tab-manager.ts';
import { setActiveTile } from '../lib/tab-manager.ts';
import { ChatPage } from '../pages/ChatPage.tsx';
import { mountExplorer } from '../pages/ExplorerPage.tsx';

export interface SplitViewProps {
  node: TileNode;
  focus: string;
  tabId: string;
}

export function SplitView(props: SplitViewProps) {
  // ── Leaf ──────────────────────────────────────────────
  if (props.node.kind === 'leaf') {
    const leaf = props.node;
    return (
      <div class="split-leaf" classList={{ 'split-leaf--focused': leaf.id === props.focus }}
           onClick={() => setActiveTile(props.tabId, leaf.id)}>
        <Show when={leaf.type === 'chat'}>
          <ChatPage sessionId={leaf.sessionId} />
        </Show>
        <Show when={leaf.type === 'explorer'}>
          <SplitExplorer />
        </Show>
      </div>
    );
  }

  // ── Split ─────────────────────────────────────────────
  const { left, right, direction, ratio } = props.node;
  const isH = direction === 'horizontal';
  const leftFlex = ratio;
  const rightFlex = 1 - ratio;

  return (
    <div class="split-container" style={{ 'flex-direction': isH ? 'row' : 'column' }}>
      <div class="split-pane" style={{ flex: leftFlex }}>
        <SplitView node={left} focus={props.focus} tabId={props.tabId} />
      </div>
      <div class="split-divider" style={{ [isH ? 'width' : 'height']: '2px' }} />
      <div class="split-pane" style={{ flex: rightFlex }}>
        <SplitView node={right} focus={props.focus} tabId={props.tabId} />
      </div>
    </div>
  );
}

/**
 * Tile explorer: monta el FileList + FilePreview dentro de un div
 * con altura completa y scroll propio.
 */
function SplitExplorer() {
  let ref: HTMLDivElement | undefined;
  onMount(() => {
    if (ref) mountExplorer(ref, undefined);
  });
  onCleanup(() => {
    if (ref) ref.replaceChildren();
  });
  return <div ref={ref} class="explorer-page" style={{ height: '100%', overflow: 'auto' }} />;
}
