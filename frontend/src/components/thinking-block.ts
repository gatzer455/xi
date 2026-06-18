/**
 * thinking-block.ts — Renderiza un array de ThinkingBlock como bloque colapsable.
 *
 * Capa 1 (rendering). Sin state, sin subscripciones, sin invoke. La función
 * toma los bloques acumulados en `message.thinking` —poblados por
 * `lib/pi/state-sync.ts` desde los eventos `thinking_delta` de pi— y devuelve
 * un `<details>` listo para insertar en el chat-bubble del assistant.
 *
 * El bloque usa `<details>`/`<summary>` nativos, no JS toggle. La plataforma
 * maneja el estado de abierto/cerrado, el teclado, y la accesibilidad.
 *
 * Decisión de diseño documentada en `.develop/02-design/thinking-and-tool-rendering.md` (D1, D2).
 */

import type { ThinkingBlock } from '../lib/state.ts';

/**
 * Renderiza los bloques de razonamiento de pi.
 *
 * @param blocks Array de `ThinkingBlock` acumulados durante el streaming.
 *               Si está vacío, retorna un `<details>` con body vacío (defensa
 *               en profundidad: el caller ya chequea con `?.length`).
 * @returns El `<details>` colapsable con el razonamiento dentro.
 */
export function ThinkingBlockUI(blocks: ThinkingBlock[]): HTMLElement {
  const details = document.createElement('details');
  details.className = 'thinking-block';

  const summary = document.createElement('summary');
  summary.className = 'thinking-summary';
  const count = blocks.length;
  summary.textContent = `Pensando… (${count} ${count === 1 ? 'bloque' : 'bloques'})`;
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'thinking-body';
  body.textContent = blocks.map((b) => b.content).join('\n\n');
  details.append(body);

  return details;
}
