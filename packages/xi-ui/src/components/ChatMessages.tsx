/**
 * ChatMessages.tsx — Lista de mensajes renderizada con SolidJS + SolidMarkdown.
 *
 * Reemplaza el pipeline vanilla: SmoothStreamer + reconcileDom + markdown.ts.
 * SolidMarkdown con renderingStrategy="reconcile" hace DOM diffing del AST
 * de markdown — solo re-renderiza los nodos que cambiaron.
 *
 * Se monta via render() en chat.ts, que le pasa los mensajes como señal
 * mediante createWrappedSignal (bridge entre signal() legacy y createSignal).
 */

import { createSignal, createEffect, For, Show, onCleanup, onMount, type JSX } from 'solid-js';
import { SolidMarkdown } from 'solid-markdown';
import type { ChatMessage, Part } from '../lib/chat/types.ts';
import { extractText } from '../lib/chat/mapping.ts';
import { ToolChipGroup as VanillaToolChipGroup } from './chip-groups.ts';

// ─── Bridge: signal() legacy → createSignal de SolidJS ───
// Convierte una signal de nuestro sistema (con .value / .subscribe)
// en una SolidJS signal reactiva que SolidMarkdown puede trackear.

export function createWrappedSignal<T>(
  customSig: { value: T; subscribe: (fn: (v: T) => void) => () => void },
) {
  const [value, setValue] = createSignal<T>(customSig.value);
  onCleanup(customSig.subscribe((v) => setValue(() => v)));
  return value;
}

// ─── Componente principal ─────────────────────────────────

export function ChatMessages(props: {
  messages: () => ChatMessage[];
  streaming: () => boolean;
}) {
  let sentinelRef: HTMLDivElement | undefined;

  // Auto-scroll al fondo cuando cambian los mensajes (una vez,
  // no durante streaming activo — el usuario controla el scroll).
  createEffect(() => {
    const msgs = props.messages();
    if (msgs.length > 0 && sentinelRef) {
      sentinelRef.scrollIntoView({ block: 'end', behavior: 'instant' });
    }
  });

  return (
    <div class="chat-messages-inner">
      <For each={props.messages()}>
        {(msg) => <MessageBubble message={msg} />}
      </For>
      <div ref={sentinelRef} class="chat-end-sentinel" />
    </div>
  );
}

// ─── Bubble individual ────────────────────────────────────

function MessageBubble(props: { message: ChatMessage }) {
  const cls = () => {
    const role = props.message.role;
    return `message message--${role}${props.message.isStreaming ? ' message--streaming' : ''}`;
  };

  return (
    <div class={cls()} data-message-id={props.message.id}>
      {props.message.role === 'assistant' ? <AssistantContent message={props.message} /> : null}
      {props.message.role === 'user' ? <UserContent message={props.message} /> : null}
      {props.message.role === 'compaction' ? <CompactionContent message={props.message} /> : null}
    </div>
  );
}

// ─── Assistant: chips + markdown streaming ────────────────

function AssistantContent(props: { message: ChatMessage }) {
  const text = () => extractText(props.message);
  let chipRef: HTMLDivElement | undefined;

  onMount(() => {
    if (chipRef && hasChips(props.message)) {
      const chipEl = VanillaToolChipGroup(props.message);
      if (chipEl) chipRef.append(chipEl);
    }
  });

  return (
    <div class="message-content message-content--assistant">
      <div ref={chipRef} />
      <div class="message-text message-text--assistant"
           classList={{ 'message-text--streaming': props.message.isStreaming }}>
        <SolidMarkdown
          children={text()}
          renderingStrategy="reconcile"
          class="md-root"
        />
      </div>
    </div>
  );
}

// ─── User: texto plano (no necesita markdown) ─────────────

function UserContent(props: { message: ChatMessage }) {
  return (
    <div class="message-content message-content--user">
      <div class="message-text message-text--user">
        {extractText(props.message)}
      </div>
    </div>
  );
}

// ─── Compaction divider ───────────────────────────────────

function CompactionContent(props: { message: ChatMessage }) {
  const part = () => props.message.parts.find(isCompaction);
  const tokensBefore = () => part()?.tokensBefore ?? 0;
  const summary = () => part()?.summary ?? '';

  return (
    <details class="compaction-divider">
      <summary class="compaction-summary">
        Compaction: {formatTokens(tokensBefore())} compactados
      </summary>
      <Show when={summary()}>
        <pre class="compaction-body">{summary()}</pre>
      </Show>
    </details>
  );
}

// ─── Helpers ──────────────────────────────────────────────

const isCompaction = (p: Part): p is Part & { type: 'compaction' } => p.type === 'compaction';

function hasChips(msg: ChatMessage): boolean {
  return msg.parts.some((p) => p.type === 'thinking' || p.type === 'toolCall');
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K tokens`;
  return `${(n / 1_000_000).toFixed(2)}M tokens`;
}
