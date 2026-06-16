/**
 * state.ts — Capa 4 (State)
 *
 * Las signals globales que representan el estado de la app.
 * Viven fuera del DOM → sobreviven a la navegación entre páginas.
 *
 * Adaptado de musicologo para xi.
 */

import { signal, type Signal } from './signal.ts';

// ═══════════════════════════════════════════════════════
// Tipos — se refinarán cuando implementemos pi-rpc
// ═══════════════════════════════════════════════════════

export interface PiModel {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export interface ThinkingBlock {
  content: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: ThinkingBlock[];
  isStreaming?: boolean;
}

export interface Session {
  id: string;
  name?: string;
  file?: string;
  messageCount: number;
}

// ═══════════════════════════════════════════════════════
// Estado global
// ═══════════════════════════════════════════════════════

export const appState = {
  /** Directorio de trabajo actual. null = no seleccionado. */
  workingDir: signal<string | null>(null),

  /** Sesión actual de pi. null = no hay sesión activa. */
  session: signal<Session | null>(null),

  /** Mensajes de la conversación actual. */
  messages: signal<ChatMessage[]>([]),

  /** true = pi está generando una respuesta. */
  isStreaming: signal(false),

  /** Modelo actual de pi. */
  currentModel: signal<PiModel | null>(null),

  /** Nivel de thinking actual. */
  thinkingLevel: signal<string>('medium'),

  /** true = pi está compactando contexto. */
  isCompacting: signal(false),

  /** Estado de conectividad. */
  online: signal(navigator.onLine),
};

// Mantener online sincronizado con el navegador
window.addEventListener('online', () => {
  appState.online.value = true;
});
window.addEventListener('offline', () => {
  appState.online.value = false;
});
