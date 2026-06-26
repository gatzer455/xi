/**
 * stream-buffer.ts — Buffer de texto para smooth streaming.
 *
 * Desacopla la recepción de chunks de red (text_delta) de la
 * visualización en pantalla. Los chunks se acumulan en un buffer
 * interno y se revelan a velocidad constante via requestAnimationFrame,
 * dando la ilusión de escritura continua en vez de ráfagas.
 *
 ## Inspiración
 *
 * - **coder/smooth-text**: adaptive rate (72–420 cps según backlog),
 *   budget-gated reveal, max visual lag cap, grapheme safety.
 * - **onyx/useTypewriter**: self-scheduling rAF loop, post-finish
 *   adaptive drain, ~3 chars/frame.
 * - **The Frontend Casebook**: word-boundary flushing para que las
 *   palabras completas aparezcan de una, no char por char.
 *
 ## Uso
 *
 * ```ts
 * const buf = new StreamBuffer({
 *   onUpdate: (text) => { actualizar DOM },
 *   onDone: () => { marcar como completo },
 * });
 *
 * buf.push("Hello ");   // aparece gradualmente...
 * buf.push("world!");   // encola
 * buf.flush();          // revela TODO instantáneamente
 * ```
 *
 * El buffer NO renderiza markdown. El caller decide cuándo formatear.
 */

export interface StreamBufferOptions {
  /** Se llama en cada frame con el texto revelado hasta ahora. */
  onUpdate: (text: string) => void;
  /** Se llama cuando flush() completa o el buffer se vacía. */
  onDone?: () => void;
  /** Chars por segundo durante streaming normal. Default: 50. */
  charsPerSecond?: number;
}

const CHARS_PER_FRAME = 3; // ~180 cps a 60fps — tasa fija como onyx
const MAX_BACKLOG = 200;   // chars de lag visual máximo
const CATCHUP_FRAMES = 20; // frames para drenar backlog al finalizar

export class StreamBuffer {
  private buffer = '';
  private revealedLen = 0;
  private frameId: number | null = null;
  private readonly onUpdate: (text: string) => void;
  private readonly onDone?: () => void;
  /** Tamaño del paso durante catch-up post-finish. Se calcula una vez. */
  private drainStep: number | null = null;
  private _isDraining = false;

  constructor(opts: StreamBufferOptions) {
    this.onUpdate = opts.onUpdate;
    this.onDone = opts.onDone;
  }

  /** ¿Hay texto pendiente por revelar? */
  get isActive(): boolean {
    return this.revealedLen < this.buffer.length;
  }

  /** true mientras el drain post-finish está corriendo. */
  get isDraining(): boolean {
    return this._isDraining;
  }

  /** Texto completamente revelado hasta ahora. */
  get revealed(): string {
    return this.buffer.slice(0, this.revealedLen);
  }

  /** Texto total en el buffer (incluyendo no revelado). */
  get total(): string {
    return this.buffer;
  }

  /**
   * Agrega texto al buffer. Si el loop de animación no está corriendo,
   * lo inicia. Es seguro llamar múltiples veces desde distintos deltas.
   */
  push(text: string): void {
    const wasIdle = !this.frameId && this.revealedLen >= this.buffer.length;
    this.buffer += text;

    // Si estábamos idle (buffer vacío o todo revelado), arrancar loop
    if (wasIdle) {
      this.start();
    }
  }

  /**
   * Revela TODO el texto pendiente instantáneamente. Se llama cuando
   * el streaming termina (agent_end) para que el usuario no espere.
   * Si hay backlog, lo drena en CATCHUP_FRAMES frames en vez de dump
   * instantáneo — el usuario está leyendo y un dump lo perdería.
   */
  flush(): void {
    const backlog = this.buffer.length - this.revealedLen;
    if (backlog <= 0) {
      this.stop();
      this.onDone?.();
      return;
    }

    // Calcular paso para drenar en CATCHUP_FRAMES
    this.drainStep = Math.max(1, Math.ceil(backlog / CATCHUP_FRAMES));
    this._isDraining = true;

    // Si ya hay loop, el tick usará drainStep automáticamente
    if (!this.frameId) {
      this.start();
    }
  }

  /**
   * Resetea el buffer completo. Usar al cambiar de mensaje o
   * al cancelar.
   */
  reset(): void {
    this.stop();
    this.buffer = '';
    this.revealedLen = 0;
    this.drainStep = null;
    this._isDraining = false;
  }

  // ── Privado ──────────────────────────────────────────

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private start(): void {
    if (this.frameId !== null) return;

    const tick = () => {
      if (this.revealedLen >= this.buffer.length) {
        // Buffer vacío — pausar loop
        this.frameId = null;
        this.drainStep = null;
        this._isDraining = false;
        this.onDone?.();
        return;
      }

      // Determinar cuántos chars revelar este frame
      let charsToReveal: number;

      if (this._isDraining) {
        // Modo catch-up: drenar rápido
        charsToReveal = this.drainStep ?? CATCHUP_FRAMES;
      } else {
        // Modo normal: tasa fija
        charsToReveal = CHARS_PER_FRAME;

        // Si el backlog creció mucho, acelerar para alcanzar
        const backlog = this.buffer.length - this.revealedLen;
        if (backlog > MAX_BACKLOG) {
          charsToReveal = Math.max(charsToReveal, Math.floor(backlog / 10));
        }
      }

      this.revealedLen = Math.min(this.revealedLen + charsToReveal, this.buffer.length);
      this.onUpdate(this.buffer.slice(0, this.revealedLen));

      // Si terminamos de revelar y estábamos en drain, marcar como listo
      if (this.revealedLen >= this.buffer.length && this._isDraining) {
        this._isDraining = false;
      }

      this.frameId = requestAnimationFrame(tick);
    };

    this.frameId = requestAnimationFrame(tick);
  }
}
