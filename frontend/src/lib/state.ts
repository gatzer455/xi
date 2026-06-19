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

  /** Nivel de thinking actual. Tipo discriminado para que setThinkingLevel
   *  rechace typos en compilación. El state-sync castea el string de pi
   *  a ThinkingLevel (es uno de los 6 valores del union). */
  thinkingLevel: signal<ThinkingLevel>('medium'),

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

  /** Lista de modelos disponibles retornada por get_available_models.
   *  Se popula lazy en main.ts después de initPiConnection. */
  availableModels: signal<PiModel[]>([]),

  /** Tema de la UI. Persistido en localStorage (xi.theme).
   *  'system' = respeta prefers-color-scheme. */
  theme: signal<ThemeMode>('dark'),

  /** Tamaño de fuente de la UI. Persistido en localStorage (xi.fontSize).
   *  Se aplica via --font-size-base en tokens.css. */
  fontSize: signal<FontSize>('medium'),

  // ── Auto-update (Etapa 7) ─────────────────────────────
  // El updater es un state machine puro: una signal `updateStatus`
  // determina qué ve la UI. Las signals restantes son datos
  // auxiliares que se consultan según el estado. Banner del top bar
  // y sección de settings leen todos de acá — single source of truth.

  updateStatus: signal<UpdateStatus>('idle'),
  updateReady: signal<UpdateInfo | null>(null),

  /** Versión del sidecar pi (viene del command get_pi_version).
   *  'unknown' si el sidecar no responde o aún no se cargó. Se
   *  popula al navegar a Settings (lazy) — el user no necesita
   *  la versión en otros contextos. */
  piVersion: signal<string>('unknown'),

  /** True si hay al menos un provider con API key configurada.
   *  Lo popula auth-status.ts al mount de welcome o settings.
   *  Drive: si false, welcome muestra banderita de "no auth". */
  hasAnyProvider: signal<boolean>(false),

  /** Lista de providers configurados (viene de get_auth_status).
   *  Cada entry tiene { id, hasKey, last4 } — la key completa
   *  NUNCA está en la signal. Para ver la key completa, el user
   *  hace click en "Ver" y se llama a getApiKey() on-demand. */
  configuredProviders: signal<Array<{ id: string; hasKey: boolean; last4: string | null }>>([]),

  /** Dismiss del banner no persiste: en el próximo launch, el banner
   *  vuelve a aparecer si hay update ready. Decisión deliberada para
   *  que el user no sienta que la app le esconde algo. */
  updateDismissed: signal<boolean>(false),

  /** Mensaje legible solo cuando updateStatus === 'error'. En otros
   *  estados es null (no muestra error donde no lo hay). */
  updateError: signal<string | null>(null),
};

/** Tema de la UI. 'system' delega al media query del CSS. */
export type ThemeMode = 'dark' | 'light' | 'system';

/** Tamaño de fuente de la UI. Default 'medium' (16px). */
export type FontSize = 'small' | 'medium' | 'large';

/** Nivel de thinking que pi acepta. Mapeo 1:1 con los valores de pi. */
export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

/** Vistas posibles del output-board (browser-shaped, sin router). */
export type ViewName = 'welcome' | 'chat' | 'sessions' | 'settings';

// ═══════════════════════════════════════════════════════
// Tipos del updater (Etapa 7)
// ═══════════════════════════════════════════════════════

/** State machine del updater. Ver `lib/updater.ts` para transiciones. */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error';

/** Datos del update que el banner y settings muestran. Parseamos
 *  una vez en frontera (en `lib/updater.ts`) y el resto del código
 *  opera sobre este tipo — sin re-validar. */
export interface UpdateInfo {
  version: string;
  body: string;
  date: string | null;
}

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
