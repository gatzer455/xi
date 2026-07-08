/**
 * sessions.ts — Página de gestión de sesiones (Etapa 4).
 *
 * Lista las sesiones del cwd activo, permite switch, rename y delete.
 * Hace polling cada 10s para reflejar cambios en el FS.
 *
 * Patrón: signal local + `setInterval` que se limpia en `page:remove`.
 * El polling se pausa si la pestaña no es visible o si hay un input
 * de rename abierto (no pisamos lo que el usuario está escribiendo).
 */

import { signal } from "../lib/signal.ts";
import { createScope, type Page } from "../lib/scope.ts";
import { appState } from "../lib/state.ts";
import {
  listSessions,
  deleteSession,
  renameSession,
  startPi,
  stopPi,
  getPiMessages,
  newPiSession,
  getPiState,
  getAvailableModels,
} from "../lib/pi/index.ts";
import type {
  ListSessionsResult,
  SessionInfo,
  SkippedInfo,
} from "../lib/pi/types.ts";
import { navigate } from "../lib/nav.ts";
import { setActiveTab, type Session } from "../lib/state.ts";
import { dropStore } from "../lib/chat/stores.ts";
import { ensurePiRunning } from "../lib/pi/lifecycle.ts";

const POLL_INTERVAL_MS = 30_000;

// Signals locales: viven a nivel de módulo (no se recrean en cada mount).
// Esto significa que conservan estado entre mounts — si el user entra
// a un workspace que falla y luego cambia a uno válido, la UI se queda
// pegada mostrando las sesiones o el error del workspace anterior.
// El fix: resetear estos signals al inicio de SessionsPage() vía
// `resetSessionsState()`, que también es testeable de forma aislada.
export const sessions = signal<SessionInfo[]>([]);
export const loading = signal<boolean>(false);
export const error = signal<string | null>(null);
/** Archivos corruptos que pi-sessions list encontró pero no pudo leer. */
export const skipped = signal<SkippedInfo | null>(null);
/** Path de la sesión cuyo nombre se está editando. null = nadie. */
export const renamingPath = signal<string | null>(null);

/**
 * Resetea los signals module-level a sus valores iniciales.
 *
 * Se llama al inicio de `SessionsPage()` para que cada mount arranque
 * limpio, sin arrastrar sesiones, errores, o estado de rename del
 * workspace anterior. Sin esto, el bug se manifestaba así: el user
 * entraba a un workspace que fallaba (ej: truncamiento de pi-sessions),
 * veía el error, cambiaba a un workspace válido, y la UI seguía
 * mostrando el error viejo o las sesiones viejas hasta que el polling
 * (10s) las refrescara.
 *
 * Exportada para testear sin necesidad de montar la página completa
 * (que requiere mockear Tauri invoke).
 */
export function resetSessionsState(): void {
  sessions.value = [];
  loading.value = false;
  error.value = null;
  skipped.value = null;
  renamingPath.value = null;
}

export function SessionsPage(): Page {
  const root = document.createElement("section");
  root.className = "sessions-page";
  const scope = createScope();

  // Reset de signals module-level: sin esto, la página conserva
  // el estado del workspace anterior (sesiones, error, loading,
  // rename). Cada mount debe arrancar limpio.
  resetSessionsState();

  root.append(renderHeader());
  root.append(renderSkipWarning(scope));
  root.append(renderErrorBanner(scope));
  root.append(renderList());
  root.append(renderFooter());

  // Carga inicial + polling.
  // Guard de re-entrada: si `loadSessions` ya está en vuelo, el segundo
  // poll no hace nada. Sin esto, dos ticks del interval se solaparían.
  void loadSessions();
  const interval = setInterval(() => {
    void loadSessions();
  }, POLL_INTERVAL_MS);

  // Pausar polling cuando la pestaña no es visible — el usuario no la mira,
  // no tiene sentido gastar CPU. Se reanuda al volver.
  const visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      void loadSessions();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  // Cleanup: el output-board llama a `dispose()` antes de cada
  // `replaceChildren`, así que el interval y el listener de visibilidad
  // se limpian al desmontar. Antes del refactor de Page, esto dependía
  // de un evento custom `page:remove` que Tauri nunca dispara — bug.
  scope.add(() => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", visibilityHandler);
  });

  return { root, dispose: () => scope.dispose() };
}

// ═══════════════════════════════════════════════════════
// Carga y render
// ═══════════════════════════════════════════════════════

async function loadSessions(): Promise<void> {
  if (loading.value) return;
  if (renamingPath.value !== null) return;

  const cwd = appState.workingDir.value;
  if (!cwd) {
    error.value = "Selecciona una carpeta de trabajo primero";
    return;
  }

  loading.value = true;
  try {
    const result: ListSessionsResult = await listSessions(cwd);
    sessions.value = result.sessions;
    skipped.value = result.skipped ?? null;
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

/**
 * Crea un banner que se oculta/muestra según un signal.
 *
 * Patrón compartido entre `renderSkipWarning` y `renderErrorBanner`:
 * ambos necesitan un div con display toggle, texto que se actualiza
 * con el valor del signal, y opcionalmente botones extra.
 *
 * @param sig Signal a observar.
 * @param className Clase CSS del banner.
 * @param format Recibe el valor del signal y devuelve el texto a
 *   mostrar, o null/'' para ocultar el banner.
 * @param extras Callback opcional para agregar elementos al banner
 *   (ej. botón de cerrar).
 */
function createSignalBanner<T>(
  sig: import("../lib/signal.ts").Signal<T>,
  className: string,
  format: (value: T) => string | null,
  scope: import("../lib/scope.ts").Scope,
  extras?: (banner: HTMLElement) => void,
): HTMLElement {
  const banner = document.createElement("div");
  banner.className = className;
  banner.style.display = "none";

  const text = document.createElement("span");
  const unsub = sig.subscribe((value) => {
    const msg = format(value);
    text.textContent = msg ?? "";
    banner.style.display = msg ? "block" : "none";
  });
  // Sin scope.add(), esta suscripción nunca se limpia. Cada mount de
  // SessionsPage() crea una nueva y la anterior queda colgada — el DOM
  // se descartó pero el callback sigue referenciando text y banner,
  // que el GC no puede recolectar porque la suscripción los mantiene
  // vivos. Con scope.add(), dispose() las desregistra a todas.
  scope.add(unsub);
  banner.append(text);

  if (extras) extras(banner);

  return banner;
}

function renderHeader(): HTMLElement {
  const header = document.createElement("header");
  header.className = "sessions-header";

  const title = document.createElement("h1");
  title.textContent = "Sesiones";
  header.append(title);

  // Acción primaria del historial: crear nueva conversación.
  // Modelo: el id de la tab es un UUID generado en el cliente
  // (no el sessionId de pi). Esto garantiza que cada tab tenga
  // identidad única INMEDIATA, sin depender de la respuesta
  // asíncrona de pi. La sesión de pi se carga después, en background.
  const newBtn = document.createElement("button");
  newBtn.className = "sessions-new";
  newBtn.textContent = "+ Nueva conversación";
  newBtn.addEventListener("click", () => {
    if (!appState.workingDir.value) {
      error.value = "Selecciona una carpeta de trabajo primero";
      return;
    }
    void createNewTab();
  });
  header.append(newBtn);

  const backBtn = document.createElement("button");
  backBtn.className = "sessions-back";
  backBtn.textContent = "← Volver";
  backBtn.addEventListener("click", () => {
    // Si hay una sesión activa, volver al chat. Si no, volver a welcome
    // para elegir otro proyecto.
    if (appState.activeTabId.value) {
      navigate("chat");
    } else {
      navigate("welcome");
    }
  });
  header.append(backBtn);

  return header;
}

function renderSkipWarning(
  scope: import("../lib/scope.ts").Scope,
): HTMLElement {
  return createSignalBanner(
    skipped,
    "sessions-skip-warning",
    (s) => {
      // SessionManager.list silencia archivos corruptos o sin header
      // válído. El usuario debe saber que no se muestran todas las
      // sesiones, aunque el error no sea fatal.
      if (s && s.count > 0) {
        return `⚠ ${s.count} archivo(s) de sesión no se pudieron leer (corruptos o vacíos)`;
      }
      return null;
    },
    scope,
  );
}

function renderErrorBanner(
  scope: import("../lib/scope.ts").Scope,
): HTMLElement {
  return createSignalBanner(
    error,
    "sessions-error",
    (e) => e ?? null,
    scope,
    (banner) => {
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => {
        error.value = null;
      });
      banner.append(closeBtn);
    },
  );
}

function renderList(): HTMLElement {
  const list = document.createElement("div");
  list.className = "sessions-list";

  const inner = document.createElement("div");
  inner.className = "sessions-list-inner";

  function repaint(items: SessionInfo[]) {
    inner.replaceChildren();

    if (!appState.workingDir.value) {
      inner.append(emptyState("Selecciona una carpeta de trabajo", null));
      return;
    }
    if (items.length === 0) {
      inner.append(emptyState("No hay sesiones en este proyecto", null));
      return;
    }

    items.forEach((session) => {
      inner.append(renderItem(session));
    });
  }

  // TODO: cuando refactoricemos los signals module-level a scope.signal(),
  // esta suscripción a `sessions` (también module-level) se va a trackear
  // acá. Por ahora, el bug preexistente es: si el user entra y sale
  // múltiples veces, se acumulan callbacks de repaint.
  // También re-renderizar cuando cambia el target de rename (abrir/cerrar input).
  sessions.subscribe(repaint);
  renamingPath.subscribe(() => repaint(sessions.value));
  repaint(sessions.value);

  list.append(inner);
  return list;
}

function renderFooter(): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "sessions-footer";

  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = "↻ Refrescar";
  refreshBtn.disabled = false;
  refreshBtn.addEventListener("click", () => {
    void loadSessions();
  });
  footer.append(refreshBtn);

  // Indicador de polling
  const status = document.createElement("span");
  status.className = "sessions-status";
  status.textContent = "actualiza cada 10s";
  footer.append(status);

  return footer;
}

// ═══════════════════════════════════════════════════════
// Item de la lista
// ═══════════════════════════════════════════════════════

function renderItem(session: SessionInfo): HTMLElement {
  const item = document.createElement("article");
  item.className = "session-card";

  const isActive = session.path === appState.session.value?.file;
  if (isActive) item.classList.add("is-active");

  // ── Header del item: nombre + acciones ──
  const header = document.createElement("div");
  header.className = "session-item-header";

  const nameEl = document.createElement("div");
  nameEl.className = "session-item-name";
  header.append(nameEl);

  if (isActive) {
    const badge = document.createElement("span");
    badge.className = "session-badge-active";
    badge.textContent = "Activa";
    header.append(badge);
  }

  // Botones de acción directos: renombrar inline y borrar.
  const actions = document.createElement("div");
  actions.className = "session-item-actions";

  const renameBtn = document.createElement("button");
  renameBtn.className = "session-item-action";
  renameBtn.textContent = "✎";
  renameBtn.title = "Renombrar";
  renameBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    renamingPath.value = session.path;
  });
  actions.append(renameBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "session-item-action session-item-action--danger";
  deleteBtn.textContent = "✕";
  deleteBtn.title = "Borrar";
  deleteBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void handleDelete(session);
  });
  actions.append(deleteBtn);

  header.append(actions);

  item.append(header);

  // ── Preview del primer mensaje ──
  const preview = document.createElement("div");
  preview.className = "session-item-preview";
  preview.textContent =
    session.messageCount === 0
      ? "(sin mensajes)"
      : truncate(session.firstMessage, 120);
  item.append(preview);

  // ── Stats: mensajes + cuándo ──
  const stats = document.createElement("div");
  stats.className = "session-item-stats";
  const count = document.createElement("span");
  count.textContent = `${session.messageCount} mensajes`;
  stats.append(count);
  const dot = document.createElement("span");
  dot.textContent = " · ";
  stats.append(dot);
  const when = document.createElement("span");
  when.textContent = timeAgo(session.modified);
  stats.append(when);
  item.append(stats);

  // ── Renderizar el nombre (puede ser <span> o <input> si está en rename) ──
  paintName(nameEl, session);

  // Click en el item (no en el menú) → switch.
  // Click abre la sesión; doble click sobre el nombre activa rename.
  item.addEventListener("click", () => {
    void switchToSession(session);
  });

  // Doble click en el nombre → renombrar inline.
  nameEl.addEventListener("dblclick", (ev) => {
    ev.stopPropagation();
    renamingPath.value = session.path;
  });

  return item;
}

function paintName(container: HTMLElement, session: SessionInfo): void {
  container.replaceChildren();

  const isRenaming = renamingPath.value === session.path;

  if (isRenaming) {
    const input = document.createElement("input");
    input.className = "session-item-name-input";
    input.type = "text";
    input.value = session.name ?? "";
    input.autofocus = true;
    attachRenameHandlers(input, session, () => {
      renamingPath.value = null;
    });
    container.append(input);
  } else {
    const span = document.createElement("span");
    span.textContent = session.name ?? formatDate(session.created);
    container.append(span);
  }
}

// ═══════════════════════════════════════════════════════
// Menú ⋯ — renombrar / borrar
// ═══════════════════════════════════════════════════════


function attachRenameHandlers(
  input: HTMLInputElement,
  session: SessionInfo,
  cancel: () => void,
): void {
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const newName = input.value.trim();
      if (newName === "" || newName === session.name) {
        cancel();
        return;
      }
      void handleRename(session, newName, cancel);
    } else if (ev.key === "Escape") {
      cancel();
    }
  });
  input.addEventListener("blur", () => {
    // Si el usuario clickeó fuera sin Enter, cancelar.
    if (renamingPath.value === session.path) cancel();
  });
}

// ═══════════════════════════════════════════════════════
// Acciones
// ═══════════════════════════════════════════════════════

/**
 * Crea una nueva tab con identidad de cliente (UUID) y pide a pi
 * una nueva sesión en background. La tab es visible y seleccionable
 * inmediatamente — no espera a pi. Cuando pi responda con el
 * sessionId, el listener actualizará los metadatos (name, file)
 * vía `updateActiveTabFromPiSession`.
 *
 * Esto evita que el id del tab dependa de la respuesta asíncrona
 * de pi. Si pi tarda o falla, la tab sigue siendo seleccionable y
 * muestra el estado vacío.
 */
async function createNewTab(): Promise<void> {
  // 1. UUID del cliente = identidad de la tab.
  const tabId = crypto.randomUUID();
  const now = new Date();
  const placeholderName = now.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const newTab: Session = {
    id: tabId,
    name: placeholderName,
    messageCount: 0,
  };

  // 2. Guardar mensajes de la tab actual antes de cambiar.
  //    Reusamos setActiveTab para garantizar el invariante
  //    "messages siempre refleja el activeTabId".
  setActiveTab(tabId);

  // 3. Agregar la tab a openTabs DESPUÉS de setActiveTab (si no,
  //    el find dentro de setActiveTab no la encontraría).
  appState.openTabs.value = [...appState.openTabs.value, newTab];
  // Mensajes viven en el ChatStore del tab (frescos, vacíos).

  // 4. Navegar al chat.
  navigate("chat");

  // 5. Pedir a pi la nueva sesión EN BACKGROUND. No bloqueamos
  //    la UI. Si falla, la tab queda vacía pero usable.
  await syncPiSessionInBackground(tabId);
}

/**
 * Pide a pi una nueva sesión y, cuando responda, actualiza los
 * metadatos (name, file) de la tab. No toca el id del tab
 * (sigue siendo el UUID del cliente).
 */
async function syncPiSessionInBackground(tabId: string): Promise<void> {
  try {
    const now = new Date();
    const cwd = appState.workingDir.value;
    if (!cwd) {
      throw new Error("No hay carpeta de trabajo seleccionada");
    }
    // Pi debe estar corriendo antes de pedirle una sesión nueva.
    // Usamos ensurePiRunning (no-op si ya corre) en vez de
    // startPi: este último siempre mataría y re-spawnea pi en el
    // backend, y new chat NO necesita restart — pi crea la sesión
    // nueva vía el comando JSONL `new_session`.
    await ensurePiRunning();
    await newPiSession();
    await getPiState();
    getAvailableModels();
    // Si pi no asignó nombre, ponemos la fecha de creación.
    const piSession = appState.session.value;
    if (!piSession) return;
    if (!piSession.name) {
      const dateName = now.toLocaleDateString("es-CL", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      if (!piSession.file) return;
      try {
        await renameSession(piSession.file, dateName);
        piSession.name = dateName;
      } catch {
        // Best-effort: si rename falla, seguimos sin nombre
      }
    }
    // Aplicar metadatos de pi a la tab correspondiente.
    appState.openTabs.value = appState.openTabs.value.map((t) =>
      t.id === tabId
        ? {
            ...t,
            name: piSession.name || t.name,
            file: piSession.file,
            messageCount: piSession.messageCount,
          }
        : t,
    );
    // Refrescar la lista de sesiones del historial.
    void loadSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Abre una sesión existente (de la lista del historial) como tab.
 * El id de la tab es el sessionId de pi (que viene de la lista
 * persistida en disco, es estable). Esto es diferente de
 * `createNewTab` donde el id es un UUID del cliente — en sesiones
 * existentes, el id de pi ya es único y estable, así que lo
 * reusamos.
 */
async function switchToSession(session: SessionInfo): Promise<void> {
  const cwd = appState.workingDir.value;
  if (!cwd) return;

  const newTab: Session = {
    id: session.id,
    name: session.name,
    file: session.path,
    messageCount: session.messageCount,
  };

  // Si la sesión ya está abierta como tab, solo cambiar a ella.
  const isOpen = appState.openTabs.value.some((t) => t.id === session.id);
  if (isOpen) {
    setActiveTab(session.id);
    navigate("chat");
    return;
  }

  // Sesión nueva: agregarla a openTabs y cargar mensajes de pi.
  setActiveTab(session.id);
  appState.openTabs.value = [...appState.openTabs.value, newTab];

  loading.value = true;
  try {
    await startPi(cwd, session.path);
    await getPiState();
    await getPiMessages();
    getAvailableModels();
    navigate("chat");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    navigate("chat");
  } finally {
    loading.value = false;
  }
}

async function handleDelete(session: SessionInfo): Promise<void> {
  if (!confirm("¿Borrar esta sesión?")) return;

  const isActive = session.path === appState.session.value?.file;
  if (
    isActive &&
    !confirm("Esta es tu sesión activa. Se cerrará. ¿Continuar?")
  ) {
    return;
  }

  try {
    await deleteSession(session.path);

    // Recolectar todos los tabs que apuntan a esta sesión (puede
    // haber múltiples tabs con distinto UUID para el mismo path).
    const tabsToRemove = appState.openTabs.value.filter(
      (t) => t.file === session.path || t.id === session.id
    ).map((t) => t.id);

    for (const tabId of tabsToRemove) {
      dropStore(tabId);
    }

    appState.openTabs.value = appState.openTabs.value.filter(
      (t) => !tabsToRemove.includes(t.id)
    );

    if (isActive) {
      // La sesión activa fue eliminada. Detener pi.
      await stopPi();
      appState.activeTabId.value = null;
      appState.session.value = null;
    }
    // Update optimístico: remover del listado local sin esperar loadSessions.
    sessions.value = sessions.value.filter((s) => s.path !== session.path);
    void loadSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleRename(
  session: SessionInfo,
  newName: string,
  onDone: () => void,
): Promise<void> {
  // Update optimístico: cambiar nombre localmente.
  sessions.value = sessions.value.map((s) =>
    s.path === session.path ? { ...s, name: newName } : s,
  );
  try {
    await renameSession(session.path, newName);
    onDone();
    void loadSessions();
  } catch (err) {
    // Revertir al nombre anterior.
    sessions.value = sessions.value.map((s) =>
      s.path === session.path ? { ...s, name: session.name } : s,
    );
    error.value = err instanceof Error ? err.message : String(err);
    onDone();
  }
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function emptyState(message: string, ctaHref: string | null): HTMLElement {
  const div = document.createElement("div");
  div.className = "sessions-empty";

  const p = document.createElement("p");
  p.textContent = message;
  div.append(p);

  if (ctaHref) {
    const a = document.createElement("a");
    a.href = ctaHref;
    a.textContent = "Ir al chat";
    div.append(a);
  }
  return div;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDate(unixMs: number): string {
  const d = new Date(unixMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function timeAgo(unixMs: number): string {
  const seconds = Math.floor((Date.now() - unixMs) / 1000);
  if (seconds < 60) return "hace segundos";
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86_400)} d`;
}
