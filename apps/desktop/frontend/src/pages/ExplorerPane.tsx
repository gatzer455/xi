/**
 * ExplorerPane.tsx — Componente SolidJS para el explorador de archivos
 * dentro de un panel. Envuelve la factory existente para compatibilidad.
 */
import { onMount, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { explorerPageFactory } from './ExplorerPage.tsx';

export function ExplorerPane() {
  let ref: HTMLDivElement | undefined;
  let dispose: (() => void) | null = null;

  onMount(() => {
    if (!ref) return;
    const page = explorerPageFactory();
    ref.append(page.root);
    dispose = () => page.dispose();
  });
  onCleanup(() => dispose?.());

  return <div ref={ref} class="explorer-page" />;
}
