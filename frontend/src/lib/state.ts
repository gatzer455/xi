/**
 * state.ts — Capa 4 (State)
 *
 * Las signals globales que representan el estado de la app.
 * Viven fuera del DOM → sobreviven a la navegación entre páginas.
 *
 * Adaptado de musicologo para xi.
 */

import { signal, type Signal } from './signal.ts';
import type { Recent } from './pi/types.ts';

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
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: ThinkingBlock[];
  isStreaming?: boolean;
  /** Solo para role: 'toolResult'. Permite renderizar la card del resultado. */
  toolResult?: {
    toolName: string;
    isError: boolean;
  };
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

  /** Proyectos recientes persistidos en app_config_dir/recents.json.
   *  Se cargan una vez al iniciar (en main.ts antes del primer render)
   *  y se actualizan cuando el usuario abre un proyecto. */
  recents: signal<Recent[]>([]),

  /** Vista activa del output-board. Reemplaza al router hash-based.
   *  El header y el input cambian este valor; el output-board se
   *  suscribe y re-renderiza. */
  currentView: signal<ViewName>('welcome'),

  /** Sesiones abiertas como tabs en el top bar (browser-shaped).
   *  Cada tab es una sesión que el usuario está viendo. `activeTabId`
   *  indica cuál está activa. `tabMessages` guarda los mensajes
   *  de cada tab (se mantienen al switchear). */
  openTabs: signal<Session[]>([]),

  /** Id de la tab activa. null = no hay tab activa. */
  activeTabId: signal<string | null>(null),

  /** Mensajes de cada tab, indexados por sessionId. Permite que
   *  cada tab mantenga su historial al switchear. */
  tabMessages: signal<Record<string, ChatMessage[]>>({}),
};

/** Vistas posibles del output-board (browser-shaped, sin router). */
export type ViewName = 'welcome' | 'chat' | 'sessions' | 'settings';

// Mantener online sincronizado con el navegador
window.addEventListener('online', () => {
  appState.online.value = true;
});
window.addEventListener('offline', () => {
  appState.online.value = false;
});

/**
 * Cambia la tab activa. Antes de cambiar, guarda los mensajes
 * actuales en `tabMessages[oldId]`. Después, carga los mensajes
 * de la nueva tab en `appState.messages`. Esto permite que cada
 * tab mantenga su historial al switchear.
 *
 * Importante: NO toca `appState.session`. Esa signal refleja qué
 * sesión tiene pi cargada en este momento (la del activeTabId por
 * invariante), pero su `id` es el sessionId de pi, no el id del
 * tab. El id del tab es el UUID generado en el cliente en el
 * momento de crear la tab (independiente de pi). Esto evita que
 * tabs colisionen cuando pi tarda en responder con su sessionId.
 *
 * Si la tab no tiene mensajes guardados, `appState.messages` queda
 * en `[]` (la vista chat mostrará el welcome state hasta que se
 * carguen los mensajes de pi).
 */
export function setActiveTab(tabId: string | null): void {
  const oldId = appState.activeTabId.value;
  if (oldId === tabId) return;

  // Guardar mensajes actuales en la tab vieja.
  if (oldId) {
    appState.tabMessages.value = {
      ...appState.tabMessages.value,
      [oldId]: appState.messages.value,
    };
  }

  appState.activeTabId.value = tabId;
  appState.messages.value = tabId
    ? appState.tabMessages.value[tabId] ?? []
    : [];
}

/** Retorna la tab activa (de openTabs), o null si no hay. */
export function getActiveTab(): Session | null {
  const id = appState.activeTabId.value;
  if (!id) return null;
  return appState.openTabs.value.find(t => t.id === id) ?? null;
}
