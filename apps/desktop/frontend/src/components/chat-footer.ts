/**
 * chat-footer.ts — Indicador de "Trabajando…" con spinner braille.
 *
 * Etapa 8 (chat-architecture-v2, R9). Reemplaza el indicador temporal
 * que vivía en el header del chat. El footer aparece al pie del
 * chat-area (encima del input bar) cuando la sesión activa está
 * streameando, y desaparece cuando termina.
 *
 * El spinner es el mismo braille que usa pi-TUI (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`), a
 * 80ms por frame — la firma visual de pi, adaptada para web. El texto
 * por defecto es "Trabajando…" (español neutro, alineado con el
 * placeholder del InputBar). El usuario no sabe qué es "pi"; xi es la
 * app.
 *
 * El footer SOLO responde a `setVisible` / `setMessage`. No conoce
 * signals ni stores: el ChatPage conecta `isStreaming$` del store
 * activo a `setVisible`. Así el footer es un componente puro de UI,
 * testeable en aislamiento.
 */

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;
const DEFAULT_MESSAGE = 'Trabajando…';

export interface ChatFooterHandle {
  /** Root del footer. Se inserta en el chat-area. */
  readonly root: HTMLElement;
  /** Muestra/oculta el footer y arranca/detiene el spinner. */
  setVisible(visible: boolean): void;
  /** Actualiza el texto del label (ej. "Compactionándose…"). */
  setMessage(text: string): void;
  /** Detiene el spinner y libera el interval. Llamar al desmontar. */
  dispose(): void;
}

export function ChatFooter(): ChatFooterHandle {
  const root = document.createElement('div');
  root.className = 'chat-footer';
  root.style.display = 'none';

  const spinner = document.createElement('span');
  spinner.className = 'chat-footer-spinner';
  // Frame inicial visible para que al aparecer no esté vacío 80ms.
  spinner.textContent = BRAILLE_FRAMES[0];

  const label = document.createElement('span');
  label.className = 'chat-footer-label';
  label.textContent = DEFAULT_MESSAGE;

  root.append(spinner, label);

  let frameIndex = 0;
  let intervalId: number | null = null;

  function tick(): void {
    spinner.textContent = BRAILLE_FRAMES[frameIndex];
    frameIndex = (frameIndex + 1) % BRAILLE_FRAMES.length;
  }

  function setVisible(visible: boolean): void {
    if (visible) {
      if (intervalId === null) {
        // tick() inmediatamente para no mostrar el frame estático 80ms,
        // luego avanza cada FRAME_INTERVAL_MS.
        tick();
        intervalId = window.setInterval(tick, FRAME_INTERVAL_MS);
      }
      root.style.display = '';
    } else {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      root.style.display = 'none';
    }
  }

  function setMessage(text: string): void {
    label.textContent = text;
  }

  function dispose(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { root, setVisible, setMessage, dispose };
}