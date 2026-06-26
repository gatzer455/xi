/**
 * chat-context-bar.ts — Barra de contexto del chat (Etapas 9–11).
 *
 * Barra fija entre los mensajes y el input, SIEMPRE visible (fuera del
 * scroll de output-board). Muestra de izquierda a derecha:
 *
 *   [spinner braille] [% ████░░ / NNN ctx] [modelo ↕]
 *
 * - **Spinner**: mismo braille que pi-TUI (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` 80ms/frame).
 *   Se oculta/muestra según `appState.isStreaming`.
 * - **Token bar**: suma el `usage.total` de todos los assistant messages
 *   del store activo y lo muestra contra el límite de contexto del
 *   modelo. Barra de progreso visual + texto.
 * - **Modelo**: nombre del modelo activo desde `appState.currentModel`.
 *   Click → abre picker (Etapa 10). Por ahora placeholder.
 *
 * El componente se monta en el SHELL (main.ts), no en ChatPage. Esto
 * lo mantiene fuera del scroll de output-board — siempre visible en
 * la parte baja del viewport.
 */

import { appState } from '../lib/state.ts';
import { getStore } from '../lib/chat/stores.ts';

// ─── Braille spinner (mismo ciclo que ChatFooter) ─────────

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;

// ─── Límites de contexto por modelo (hardcodeados por ahora) ──

const CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4': 8192,
  'gpt-4-turbo': 128000,
  'claude-3-5-sonnet': 200000,
  'claude-3-opus': 200000,
  'claude-3-haiku': 200000,
  'claude-2': 100000,
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'deepseek-chat': 128000,
  'llama-3.1-405b': 128000,
  'llama-3.1-70b': 128000,
  'llama-3.1-8b': 128000,
  'mistral-large': 128000,
  'mixtral-8x22b': 65536,
};

const DEFAULT_MAX = 128000;

/** Retorna el context window del modelo actual. Primero intenta
 *  usar el valor real que pi reporta (appState.currentModel.contextWindow),
 *  y si no esta disponible cae a la lookup table hardcodeada.
 *  
 *  Pi envia el contextWindow real del modelo en get_state (el Model
 *  de pi-ai tiene el campo). Asi evitamos desactualizaciones cuando
 *  los modelos cambian su contexto o cuando el usuario usa un modelo
 *  no listado en nuestro lookup. */
function getContextWindow(): number {
  const fromModel = appState.currentModel.value?.contextWindow;
  if (fromModel && fromModel > 0) return fromModel;

  const modelId = appState.currentModel.value?.id;
  if (!modelId) return DEFAULT_MAX;
  if (CONTEXT_WINDOWS[modelId]) return CONTEXT_WINDOWS[modelId];
  for (const [key, val] of Object.entries(CONTEXT_WINDOWS)) {
    if (modelId.startsWith(key)) return val;
  }
  return DEFAULT_MAX;
}

// ─── Formateo de números ──────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v % 1 === 0 ? `${v}M` : `${v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v % 1 === 0 ? `${v}K` : `${v.toFixed(1)}K`;
  }
  return String(n);
}

// ─── Handle ────────────────────────────────────────────────

export interface ChatContextBarHandle {
  readonly root: HTMLElement;
  dispose(): void;
}

// ─── Componente ────────────────────────────────────────────

export function ChatContextBar(): ChatContextBarHandle {
  const root = document.createElement('div');
  root.className = 'context-bar';
  // La barra es SIEMPRE visible. Solo el spinner + "Trabajando…" se
  // oculta/muestra según appState.isStreaming. El resto (tokens,
  // modelo) está siempre presente.

  // ── Spinner ──
  const spinner = document.createElement('span');
  spinner.className = 'context-bar-spinner';
  spinner.textContent = BRAILLE_FRAMES[0];
  root.append(spinner);

  // ── Label "Trabajando…" ──
  const label = document.createElement('span');
  label.className = 'context-bar-label';
  label.textContent = 'Trabajando…';
  root.append(label);

  // ── Token bar ──
  const tokenBar = document.createElement('span');
  tokenBar.className = 'context-bar-tokens';
  root.append(tokenBar);

  // ── Barra de progreso visual ──
  const progressFill = document.createElement('span');
  progressFill.className = 'context-bar-progress-fill';
  const progressBg = document.createElement('span');
  progressBg.className = 'context-bar-progress-bg';
  progressBg.append(progressFill);

  // ── Separador ──
  const sep = document.createElement('span');
  sep.className = 'context-bar-sep';
  sep.textContent = '·';

  // ── Modelo (click → picker, Etapa 10) ──
  const modelBtn = document.createElement('button');
  modelBtn.className = 'context-bar-model';
  modelBtn.textContent = 'sin modelo';
  modelBtn.title = 'Cambiar modelo';
  // Placeholder: Stage 10 implementará el modal picker.
  // Por ahora es un botón sin handler — visible pero inerte hasta
  // que conectemos el modal.

  // Grupo derecho: [barra de progreso] [·] [modelo ↕] pegado a la derecha
  const rightGroup = document.createElement('span');
  rightGroup.className = 'context-bar-right';
  rightGroup.append(progressBg, sep, modelBtn);
  root.append(rightGroup);

  // ═══ Spinner logic (misma que ChatFooter) ═══
  let frameIndex = 0;
  let intervalId: number | null = null;

  function tick(): void {
    spinner.textContent = BRAILLE_FRAMES[frameIndex];
    frameIndex = (frameIndex + 1) % BRAILLE_FRAMES.length;
  }

  function startSpinner(): void {
    if (intervalId !== null) return;
    tick();
    intervalId = window.setInterval(tick, FRAME_INTERVAL_MS);
  }

  function stopSpinner(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // ═══ Suscripciones ═══

  // El spinner y label se ocultan con visibility (no display:none)
  // para preservar su espacio y evitar que la token bar se corra
  // cuando aparecen/desaparecen.
  spinner.style.visibility = 'hidden';
  label.style.visibility = 'hidden';

  const unsubStreaming = appState.isStreaming.subscribe((streaming) => {
    spinner.style.visibility = streaming ? 'visible' : 'hidden';
    label.style.visibility = streaming ? 'visible' : 'hidden';
    if (streaming) {
      startSpinner();
    } else {
      stopSpinner();
    }
  });

  const unsubModel = appState.currentModel.subscribe((model) => {
    modelBtn.textContent = model ? model.name : 'sin modelo';
    // Recalcular token bar cuando cambia el modelo (nuevo límite)
    updateTokensFromStore();
  });

  let unsubStoreMessages: (() => void) | null = null;

  function updateTokensFromStore(): void {
    const tabId = appState.activeTabId.value;
    if (!tabId) {
      tokenBar.textContent = '';
      progressFill.style.width = '0%';
      return;
    }
    const store = getStore(tabId);
    const messages = store.messages$.value;

    // Buscar el ÚLTIMO assistant message CON usage (no los parciales
    // durante streaming que no tienen metadata). El usage.total del
    // último assistant completo refleja el contexto actual de la
    // conversación — suma de input + output acumulados hasta ese turno.
    // NO sumamos todos los mensajes (eso da el total histórico de
    // tokens facturados, que incluye compactaciones y es enorme).
    let lastUsageTotal = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.metadata?.usage?.total) {
        lastUsageTotal = m.metadata.usage.total;
        break;
      }
    }

    const maxCtx = getContextWindow();
    const pct = maxCtx > 0 ? (lastUsageTotal / maxCtx) * 100 : 0;

    // Texto: "12.3K / 128K (9.6%)"
    tokenBar.textContent = `${fmtTokens(lastUsageTotal)} / ${fmtTokens(maxCtx)} (${pct.toFixed(1)}%)`;

    // Barra de progreso: color ACCENT único (sin verde/amarillo/rojo)
    progressFill.style.width = `${Math.min(pct, 100)}%`;
    progressFill.style.background = 'var(--color-accent)';
  }

  const unsubTab = appState.activeTabId.subscribe((tabId) => {
    unsubStoreMessages?.();
    unsubStoreMessages = null;
    if (!tabId) {
      tokenBar.textContent = '';
      progressFill.style.width = '0%';
      return;
    }
    const store = getStore(tabId);
    unsubStoreMessages = store.messages$.subscribe(() => {
      updateTokensFromStore();
    });
    updateTokensFromStore();
  });

  // ═══ Tick inicial para saber si arrancar spinner ═══
  if (appState.isStreaming.value) {
    spinner.style.visibility = 'visible';
    label.style.visibility = 'visible';
    startSpinner();
  }
  updateTokensFromStore();

  // ═══ Dispose ═══
  function dispose(): void {
    stopSpinner();
    unsubStreaming();
    unsubModel();
    unsubTab();
    unsubStoreMessages?.();
  }

  return { root, dispose };
}