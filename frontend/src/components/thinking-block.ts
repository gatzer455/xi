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

import type { ThinkingPart } from '../lib/chat/types.ts';

/**
 * Renderiza los bloques de razonamiento de pi.
 *
 * @param parts Array de `ThinkingPart` (uno por bloque de thinking del
 *               assistant message). Si está vacío, el body queda vacío.
 * @returns El `<details>` colapsable con el razonamiento dentro.
 */
export function ThinkingBlockUI(parts: ThinkingPart[], isStreaming = false): HTMLElement {
  const details = document.createElement('details');
  details.className = 'thinking-block';

  const summary = document.createElement('summary');
  summary.className = 'thinking-summary';

  if (isStreaming) {
    const dots = document.createElement('span');
    dots.className = 'thinking-dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'thinking-dot';
      dots.append(dot);
    }
    summary.append(dots);
    const label = document.createElement('span');
    label.textContent = ' Pensando';
    summary.append(label);
  } else {
    const count = parts.length;
    summary.textContent = `Pensó (${count} ${count === 1 ? 'bloque' : 'bloques'})`;
  }

  details.append(summary);

  const body = document.createElement('div');
  body.className = 'thinking-body';
  body.textContent = parts.map((p) => p.text).join('\n\n');
  details.append(body);

  return details;
}
