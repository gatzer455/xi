/**
 * slash-commands.ts — Dispatcher de slash commands para xi.
 *
 * xi corre pi en `--mode rpc`. En ese modo, pi NO parsea builtins
 * (`/compact`, `/new`, …) desde un mensaje `prompt` — el TUI los
 * maneja client-side. xi replica ese rol: traduce `/cmd args` al
 * `RpcCommand` tipado y lo manda por `sendPiCommand`.
 *
 * Dos categorías:
 *  - **Builtin**: xi traduce a JSON tipado y envía. Listado en
 *    `BUILTIN_SLASH_COMMANDS` (lo que muestra `/help`).
 *  - **Extensión/skill/prompt**: pi las expande server-side desde un
 *    `prompt` común (`session.prompt()` prueba `_tryExecuteExtension
 *    Command` → `_expandSkillCommand` → `expandPromptTemplate`). Para
 *    no mandar basura al LLM, xi valida el nombre contra `get_commands`
 *    (cacheado al init) antes de dejarlo pasar como prompt.
 *
 * Es transporte-agnóstico (usa `sendPiCommand`, que rutea a Tauri IPC o
 * WS según el commandBus). Vive en xi-ui para que desktop y mobile lo
 * compartan; hoy solo lo cablea desktop.
 */

import { sendPiCommand } from './tauri-commands.ts';
import { appState } from '../state.ts';
import { addEntry } from '../debug-panel.ts';
import { getStore } from '../chat/stores.ts';
import { navigate } from '../nav.ts';
import type { ChatMessage } from '../chat/types.ts';

// ─── Builtins (lo que xi implementa + documenta en /help) ────────────────

export interface BuiltinSlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

/** Comandos builtin que xi maneja localmente. `/help` muestra esta
 *  lista (no incluye los de extensión/skill/prompt, que son dinámicos). */
export const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommand[] = [
  { name: 'compact', description: 'Compactar el contexto de la sesión', argumentHint: '[instrucciones]' },
  { name: 'new', description: 'Iniciar una sesión nueva' },
  { name: 'name', description: 'Renombrar la sesión actual', argumentHint: '<nombre>' },
  { name: 'clone', description: 'Duplicar la sesión en la posición actual' },
  { name: 'bash', description: 'Ejecutar un comando de shell', argumentHint: '<comando>' },
  { name: 'export', description: 'Exportar la sesión a HTML', argumentHint: '[ruta]' },
  { name: 'settings', description: 'Abrir la configuración' },
  { name: 'help', description: 'Mostrar esta lista de comandos' },
];

// ─── Cache de comandos de extensión/skill/prompt ─────────────────────────

/** Nombres de comandos (sin `/`) provistos por extensiones, skills y
 *  prompts. Se popula desde la respuesta RPC `get_commands` (ver
 *  `state-sync.ts`). Vacío hasta que pi responde al fetch del init. */
const extensionCommandNames = new Set<string>();

/** true una vez que llegó la respuesta de `get_commands` (aunque esté
 *  vacía). Distingue el race del init (todavía no respondió → lenientes)
 *  del estado “cargó, no hay comandos” (validar estricto, rechazar
 *  unknowns). Sin esto, un cache vacío-real desactivaría la validación
 *  para toda la sesión. */
let extensionCommandsLoaded = false;

/** Llamado por state-sync cuando llega la respuesta de `get_commands`. */
export function setKnownExtensionCommands(commands: { name: string }[]): void {
  extensionCommandNames.clear();
  for (const c of commands) extensionCommandNames.add(c.name);
  extensionCommandsLoaded = true;
}

/** Envía `get_commands` para poblar el cache. Fire-and-forget. */
export function requestExtensionCommands(): void {
  const cmd = JSON.stringify({ type: 'get_commands' });
  addEntry('out', cmd);
  sendPiCommand(cmd).catch(err => {
    addEntry('system', `[get_commands] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

export type SlashOutcome =
  | { kind: 'handled' }       // builtin despachado o mensaje local mostrado → limpiar input
  | { kind: 'prompt' }        // comando de extensión/skill/prompt → mandar como prompt
  | { kind: 'unknown'; name: string }; // no encontrado → no enviar, mantener input

/** Parsea y despacha un texto que empieza con `/`.
 *
 *  Devuelve:
 *  - `handled`: tradujo a RPC, navegó, o mostró feedback local. El
 *    caller debe limpiar el input.
 *  - `prompt`: es un comando de extensión/skill/prompt válido (o el
 *    cache aún no respondió). El caller lo manda como prompt común y
 *    pi lo expande server-side.
 *  - `unknown`: no es builtin ni está en `get_commands`. No enviar. */
export async function dispatchSlashCommand(text: string): Promise<SlashOutcome> {
  // text ya viene trim() y empieza con '/'
  const spaceIdx = text.indexOf(' ');
  const name = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).slice(1);
  const arg = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  switch (name) {
    case 'compact':
      await sendPiCommand(JSON.stringify({ type: 'compact', ...(arg ? { customInstructions: arg } : {}) }));
      return { kind: 'handled' };
    case 'new':
      await sendPiCommand(JSON.stringify({ type: 'new_session' }));
      return { kind: 'handled' };
    case 'name':
      if (!arg) { showLocalMessage('Uso: `/name <nombre>`'); return { kind: 'handled' }; }
      await sendPiCommand(JSON.stringify({ type: 'set_session_name', name: arg }));
      return { kind: 'handled' };
    case 'clone':
      await sendPiCommand(JSON.stringify({ type: 'clone' }));
      return { kind: 'handled' };
    case 'bash':
      if (!arg) { showLocalMessage('Uso: `/bash <comando>`'); return { kind: 'handled' }; }
      await sendPiCommand(JSON.stringify({ type: 'bash', command: arg }));
      return { kind: 'handled' };
    case 'export':
      await sendPiCommand(JSON.stringify({ type: 'export_html', ...(arg ? { outputPath: arg } : {}) }));
      return { kind: 'handled' };
    case 'settings':
      navigate('settings');
      return { kind: 'handled' };
    case 'help':
      showLocalMessage(formatHelp());
      return { kind: 'handled' };
    default:
      // No es builtin. Validar contra get_commands antes de mandar al LLM.
      // Si el cache aún no respondió (race del init), somos lenientes y
      // dejamos pasar como prompt: pi expande si existe. Una vez cargado
      // (aunque esté vacío), validamos estricto y rechazamos unknowns.
      if (!extensionCommandsLoaded) return { kind: 'prompt' };
      if (!extensionCommandNames.has(name)) {
        showLocalMessage(
          `Comando desconocido: \`/${name}\`. Escribí \`/help\` para ver los comandos disponibles.`,
        );
        return { kind: 'unknown', name };
      }
      return { kind: 'prompt' };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Inyecta un mensaje local en el chat del tab activo (rol assistant,
 *  markdown). Reusa el evento `local_message` del reducer: sobrevive a
 *  `agent_end` y no se envía a pi. Sin UI nueva. */
function showLocalMessage(text: string): void {
  const id = appState.activeTabId.value;
  if (!id) { addEntry('system', text); return; }
  const msg: ChatMessage = {
    id: `local_${Date.now()}`,
    role: 'assistant',
    parts: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
  getStore(id).dispatch({ type: 'local_message', message: msg });
}

function formatHelp(): string {
  const rows = BUILTIN_SLASH_COMMANDS.map(c => {
    const args = c.argumentHint ? ` \`${c.argumentHint}\`` : '';
    return `| \`/${c.name}${args}\` | ${c.description} |`;
  });
  return [
    '### Comandos de xi',
    '',
    '| Comando | Descripción |',
    '|---|---|',
    ...rows,
    '',
    'Los comandos de extensiones, skills y prompts se descubren según lo que tengas instalado.',
  ].join('\n');
}
