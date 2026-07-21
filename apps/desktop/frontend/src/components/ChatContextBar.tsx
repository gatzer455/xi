/**
 * ChatContextBar.tsx — Barra de contexto del chat (SolidJS).
 *
 * Layout: [spinner] [Trabajando…] | [tokens / ctx (N%)] [█ barra] [thinking] · [modelo ↕]
 *         spinner + "Trabajando…" solo visibles durante streaming.
 */
import { createSignal, createMemo, createEffect, onCleanup, Show } from 'solid-js';
import { appState, type ThinkingLevel } from 'xi-ui/lib/state.ts';
import { getStore } from 'xi-ui/lib/chat/stores.ts';
import { ModelPicker } from './ModelPicker.tsx';
import { setThinkingLevel } from 'xi-ui/lib/pi/tauri-commands.ts';

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const THINKING_CYCLE: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off', minimal: 'Min', low: 'Low', medium: 'Med', high: 'High', xhigh: 'Max',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

/** Capitaliza primera letra */
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export function ChatContextBar(props?: { sessionId?: string }) {
  // Si hay props.sessionId, usar esa sesión fija (modo panel)
  // Sino, escuchar activeTabId global (modo full-page)
  const fixedSessionId = () => props?.sessionId;

  const [streaming, setStreaming] = createSignal(appState.isStreaming.value);
  const [view, setView] = createSignal(appState.currentView.value);
  const [spinnerIdx, setSpinnerIdx] = createSignal(0);
  const [tokens, setTokens] = createSignal(0);
  const [model, setModelState] = createSignal(appState.currentModel.value);
  const [thinkLevel, setThinkLevel] = createSignal(appState.thinkingLevel.value);
  const [pickerOpen, setPickerOpen] = createSignal(false);

  onCleanup(appState.isStreaming.subscribe(setStreaming));
  onCleanup(appState.currentView.subscribe(setView));
  onCleanup(appState.currentModel.subscribe(setModelState));
  onCleanup(appState.thinkingLevel.subscribe(setThinkLevel));

  // Context window reactivo
  const ctxWin = createMemo(() => {
    const m = model();
    if (m?.contextWindow && m.contextWindow > 0) return m.contextWindow;
    return 128000;
  });

  // Actualizar tokens cuando cambia tab o llegan nuevos mensajes
  function updateTokens() {
    const tabId = fixedSessionId() ?? appState.activeTabId.value;
    if (!tabId) { setTokens(0); return; }
    const store = getStore(tabId);
    if (!store) { setTokens(0); return; }
    // Último assistant completo con usage (no los parciales de streaming)
    const msgs = store.messages$.value;
    let total = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant' && (m as any).metadata?.usage?.total) {
        total = (m as any).metadata.usage.total;
        break;
      }
    }
    setTokens(total);
  }

  let unsubMessages: (() => void) | null = null;

  // Suscribirse a cambios de tab activa solo si no estamos en modo panel (sessionId fijo)
  if (fixedSessionId() === undefined) {
    onCleanup(appState.activeTabId.subscribe((tabId) => {
      unsubMessages?.();
      unsubMessages = null;
      if (!tabId) { setTokens(0); return; }
      const store = getStore(tabId);
      if (store) { unsubMessages = store.messages$.subscribe(() => updateTokens()); }
      updateTokens();
    }));
  } else {
    // En modo panel, suscribirse directamente al store fijo
    const store = getStore(fixedSessionId()!);
    if (store) { unsubMessages = store.messages$.subscribe(() => updateTokens()); }
  }
  onCleanup(() => unsubMessages?.());
  // También refrescar cuando cambia el streaming (terminó de generar)
  onCleanup(appState.isStreaming.subscribe(() => updateTokens()));

  // Spinner braille durante streaming
  let intervalId: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    if (streaming()) {
      intervalId = setInterval(() => setSpinnerIdx((i) => (i + 1) % BRAILLE.length), 80);
    } else {
      if (intervalId) clearInterval(intervalId);
      intervalId = undefined;
    }
  });
  onCleanup(() => { if (intervalId) clearInterval(intervalId); });

  // Cycle thinking level on click
  function cycleThinking() {
    const current = thinkLevel();
    const idx = THINKING_CYCLE.indexOf(current);
    const next = THINKING_CYCLE[(idx + 1) % THINKING_CYCLE.length];
    appState.thinkingLevel.value = next;
    setThinkingLevel(next);
  }

  // Cuando cambia la vista, ocultar/mostrar via DOM directo
  let divRef: HTMLDivElement | undefined;
  function setRef(el: HTMLDivElement) {
    divRef = el;
    el.style.display = view() === 'chat' ? '' : 'none';
  }
  onCleanup(appState.currentView.subscribe((v) => {
    if (divRef) divRef.style.display = v === 'chat' ? '' : 'none';
  }));

  const pct = createMemo(() => ctxWin() > 0 ? (tokens() / ctxWin()) * 100 : 0);

  // Token text: vacío si no hay tokens, o formato "N / M (X%)"
  const tokenText = createMemo(() => tokens() === 0 ? '' : `${fmt(tokens())} / ${fmt(ctxWin())} (${pct().toFixed(1)}%)`);

  return (
    <div id="context-bar" class="context-bar" ref={setRef}>
      <span class="context-bar-spinner" style={{ visibility: streaming() ? 'visible' : 'hidden' }}>
        {BRAILLE[spinnerIdx()]}
      </span>
      <span class="context-bar-label" style={{ visibility: streaming() ? 'visible' : 'hidden' }}>
        Trabajando…
      </span>

      <span class="context-bar-right">
        <span class="context-bar-tokens">
          {tokenText()}
        </span>
        <span class="context-bar-progress-bg">
          <span class="context-bar-progress-fill" style={{
            width: `${Math.min(pct(), 100)}%`,
            background: 'var(--color-accent)',
          }} />
        </span>
        <button class="context-bar-think" title="Nivel de razonamiento (click: cicla)"
                onClick={cycleThinking}>
          {cap(THINKING_LABELS[thinkLevel()] ?? thinkLevel())}
        </button>
        <span class="context-bar-sep">·</span>
        <button class="context-bar-model" title="Cambiar modelo"
                onClick={() => setPickerOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickerOpen(true); } }}>
          {model()?.name ?? 'sin modelo'}
        </button>
      <Show when={pickerOpen()}><ModelPicker onClose={() => setPickerOpen(false)} /></Show>
      </span>
    </div>
  );
}
