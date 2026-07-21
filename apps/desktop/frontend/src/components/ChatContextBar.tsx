/**
 * ChatContextBar.tsx — Barra de contexto del chat: spinner, tokens, modelo.
 */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { getStore } from 'xi-ui/lib/chat/stores.ts';
import { ModelPicker } from './model-picker.ts';

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CTX: Record<string, number> = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4': 8192, 'gpt-4-turbo': 128000,
  'claude-3-5-sonnet': 200000, 'claude-3-opus': 200000, 'claude-3-haiku': 200000,
  'claude-2': 100000, 'gemini-1.5-pro': 1000000, 'gemini-1.5-flash': 1000000,
  'deepseek-chat': 128000, 'llama-3.1-405b': 128000, 'llama-3.1-70b': 128000,
  'llama-3.1-8b': 128000, 'mistral-large': 128000, 'mixtral-8x22b': 65536,
};
const DEFAULT_MAX = 128000;

function ctxWindow(): number {
  const m = appState.currentModel.value;
  if (m?.contextWindow && m.contextWindow > 0) return m.contextWindow;
  if (!m?.id) return DEFAULT_MAX;
  if (CTX[m.id]) return CTX[m.id];
  for (const [k, v] of Object.entries(CTX)) { if (m.id.startsWith(k)) return v; }
  return DEFAULT_MAX;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function ChatContextBar() {
  const [streaming, setStreaming] = createSignal(appState.isStreaming.value);
  const [spinnerIdx, setSpinnerIdx] = createSignal(0);

  onCleanup(appState.isStreaming.subscribe(setStreaming));

  // Spinner braille
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

  return (
    <div id="context-bar" class="context-bar">
      <Show when={streaming()}>
        <span class="context-spinner">{BRAILLE[spinnerIdx()]}</span>
      </Show>
      <TokenBar />
      <ModelSelector />
    </div>
  );
}

function TokenBar() {
  const [tokens, setTokens] = createSignal(0);

  function update() {
    const tabId = appState.activeTabId.value;
    if (!tabId) { setTokens(0); return; }
    const store = getStore(tabId);
    if (!store) { setTokens(0); return; }
    let sum = 0;
    for (const msg of store.messages$.value) {
      for (const p of msg.parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = p as any;
        if (u.type === 'usage' && typeof u.total === 'number') sum += u.total;
      }
    }
    setTokens(sum);
  }

  onCleanup(appState.activeTabId.subscribe(update));
  onCleanup(appState.isStreaming.subscribe(update));

  return (
    <span class="context-tokens">
      <span class="context-token-bar" style={{
        width: `${Math.min((tokens() / ctxWindow()) * 100, 100)}%`
      }} />
      <span class="context-token-text">
        {fmt(tokens())} / {fmt(ctxWindow())} ctx
      </span>
    </span>
  );
}

function ModelSelector() {
  return (
    <span class="context-model" onClick={() => ModelPicker()}>
      {appState.currentModel.value?.name ?? 'Modelo'}
    </span>
  );
}
