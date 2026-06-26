/**
 * welcome.ts — Pantalla de bienvenida y proyectos recientes (Etapa 5+9).
 *
 * Es la ruta default del router (reemplaza a `#/chat`). Se muestra
 * cuando xi arranca sin workingDir, o cuando el usuario hace click en
 * "Cambiar de proyecto" desde la sidebar.
 *
 * El sidebar está oculto en esta vista — la welcome ocupa toda la
 * pantalla. La sidebar se vuelve a mostrar cuando el usuario abre un
 * proyecto y navega a `#/chat`.
 *
 * Etapa 9 (onboarding): se agregaron 3 cosas:
 * 1. Párrafo "¿Qué es xi?" debajo del header (texto estático).
 * 2. Banderita de "no auth" condicional, alimentada por
 *    loadAuthStatus() al mount.
 * 3. Link "¿Necesitas ayuda?" al pie.
 */

import { signal, type Signal } from "../lib/signal.ts";
import { createScope, type Scope, type Page } from "../lib/scope.ts";
import { appState } from "../lib/state.ts";
import { pickAndOpenProject, openProject } from "../lib/workdir.ts";
import { navigate } from "../lib/nav.ts";
import { getRecents } from "../lib/pi/index.ts";
import type { Recent } from "../lib/pi/index.ts";
import { loadAuthStatus } from "../lib/auth-status.ts";
import { icon } from "../lib/icons.ts";
import { setApiKey, type ProviderInfo } from "../lib/pi/tauri-commands.ts";

export function WelcomePage(): Page {
  const root = document.createElement("div");
  root.className = "welcome-page";
  const scope = createScope();

  // Signal local por instancia: cada mount tiene su propio estado de
  // error. Sin esto, un error de un mount anterior persiste al
  // remontar la página y la UI muestra un banner fantasma.
  const error = signal<string | null>(null);

  root.append(renderErrorBanner(scope, error));
  root.append(renderHeader());
  root.append(renderAuthBanner(scope));
  root.append(renderProviderSection(scope));
  root.append(renderCta(error));
  root.append(renderRecentsSection(scope, error));
  root.append(renderHelpLink());

  // Cargar el estado de providers al mount. Fire-and-forget — el
  // render no espera; el banner se actualiza cuando la promesa
  // resuelve. La banderita arranca con visibility:hidden para evitar
  // flash de "no auth" cuando sí hay providers (el user apenas
  // vuelve de settings, por ejemplo).
  void loadAuthStatus();

  // Auto-cerrar la welcome cuando se setea un workingDir. Esto pasa
  // cuando el usuario hace click en un card (openProject setea
  // workingDir) o cuando el flujo externo setea workingDir mientras
  // la welcome está montada. Redirigimos a #/sessions para que el
  // usuario cree o elija una sesión antes de chatear.
  //
  // El flag `initialDir` captura el valor de workingDir al mount.
  // Si workingDir ya estaba seteado (ej: el usuario volvió a welcome
  // desde sessions), NO navegamos — solo navegamos cuando workingDir
  // CAMBIA de null a un valor (el usuario eligió un proyecto).
  const initialDir = appState.workingDir.value;
  scope.add(
    appState.workingDir.subscribe((dir) => {
      if (dir && dir !== initialDir) {
        navigate("sessions");
      }
    }),
  );

  return { root, dispose: () => scope.dispose() };
}

// ───────────────────────────────────────────────────────
// Secciones
// ───────────────────────────────────────────────────────

function renderErrorBanner(scope: Scope, error: Signal<string | null>): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "welcome-error";
  banner.style.display = "none";

  scope.add(
    error.subscribe((msg) => {
      if (msg) {
        banner.textContent = msg;
        banner.style.display = "flex";
      } else {
        banner.style.display = "none";
      }
    }),
  );

  return banner;
}

function renderHeader(): HTMLElement {
  const header = document.createElement("div");
  header.className = "welcome-header";

  const icon = document.createElement("img");
  icon.className = "welcome-icon";
  icon.src = "xi-icon.svg";
  icon.alt = "Xi";
  header.append(icon);

  const subtitle = document.createElement("p");
  subtitle.className = "welcome-subtitle";
  subtitle.textContent =
    "Xi es un asistente de inteligencia artificial. Abre un proyecto y pídele lo que necesites: " +
    "redactar documentos, analizar archivos, responder preguntas, lo que necesites.";
  header.append(subtitle);

  return header;
}

/** Banderita de "no auth" — solo se muestra si configuredProviders
 *  está vacío Y la carga inicial terminó. Mientras loadAuthStatus
 *  corre, la banderita está oculta (no debe haber flash de "no auth"
 *  cuando sí hay providers). visibility:hidden reserva el espacio
 *  para evitar layout shift. */
function renderAuthBanner(scope: Scope): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "welcome-auth-banner";

  // Estado inicial: mientras no sepamos si hay providers, escondemos
  // la banderita. La suscripción a hasAnyProvider la actualiza.
  banner.style.visibility = "hidden";

  const message = document.createElement("span");
  message.textContent = "⚠ No hay modelo configurado. Configurá tu API key para empezar.";
  banner.append(message);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "welcome-auth-banner-btn";
  button.textContent = "Ir a Configuración";
  button.addEventListener("click", () => navigate("settings"));
  banner.append(button);

  // Suscripción: aparece solo si NO hay providers. Si hay 1+, se
  // esconde. La banderita se actualiza también si el user vuelve
  // de settings (loadAuthStatus se re-ejecuta al mount).
  scope.add(
    appState.hasAnyProvider.subscribe((hasAny) => {
      banner.style.visibility = hasAny ? "hidden" : "visible";
    }),
  );

  return banner;
}

/** ── Provider config section (simplificado para welcome) ── */
const WELCOME_PROVIDERS = [
  { id: 'opencode-go', label: 'OpenCode Go' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'google', label: 'Google' },
  { id: 'groq', label: 'Groq' },
  { id: 'openai', label: 'OpenAI' },
] as const;

function renderProviderSection(scope: Scope): HTMLElement {
  const section = document.createElement('div');
  section.className = 'welcome-provider';

  const title = document.createElement('h3');
  title.className = 'welcome-provider-title';
  title.textContent = 'Configurar API key';
  section.append(title);

  // Provider selector: botones simples estilo tabs
  const tabRow = document.createElement('div');
  tabRow.className = 'welcome-provider-tabs';

  let currentProvider = 'opencode-go';
  const storageKey = 'xi.lastProvider';
  const stored = localStorage.getItem(storageKey);
  if (stored && WELCOME_PROVIDERS.some((p) => p.id === stored)) {
    currentProvider = stored;
  }

  for (const p of WELCOME_PROVIDERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'welcome-provider-tab';
    btn.dataset.provider = p.id;
    btn.textContent = p.label;
    if (p.id === currentProvider) btn.classList.add('welcome-provider-tab--active');

    btn.addEventListener('click', () => {
      currentProvider = p.id;
      localStorage.setItem(storageKey, p.id);
      tabRow.querySelectorAll('.welcome-provider-tab').forEach((b) =>
        b.classList.remove('welcome-provider-tab--active')
      );
      btn.classList.add('welcome-provider-tab--active');
    });

    tabRow.append(btn);
  }
  section.append(tabRow);

  // API key input
  const inputRow = document.createElement('div');
  inputRow.className = 'welcome-provider-input-row';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'welcome-provider-input';
  keyInput.placeholder = 'sk-...';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  inputRow.append(keyInput);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'welcome-provider-save';
  saveBtn.textContent = 'Guardar';
  inputRow.append(saveBtn);
  section.append(inputRow);

  // Feedback
  const feedback = document.createElement('div');
  feedback.className = 'welcome-provider-feedback';
  feedback.style.display = 'none';
  section.append(feedback);

  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      feedback.textContent = 'Pega una API key antes de guardar';
      feedback.style.display = 'block';
      return;
    }
    saveBtn.disabled = true;
    feedback.style.display = 'none';
    try {
      await setApiKey(currentProvider, key);
      await loadAuthStatus();
      keyInput.value = '';
      feedback.textContent = '✓ Guardado';
      feedback.style.display = 'block';
    } catch (err) {
      feedback.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      feedback.style.display = 'block';
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Mark configured providers
  function updateMarks(configured: ReadonlyArray<{ id: string; hasKey: boolean; last4: string | null }>): void {
    for (const btn of tabRow.querySelectorAll<HTMLElement>('.welcome-provider-tab')) {
      const id = btn.dataset.provider;
      if (!id) continue;
      const isConfigured = configured.some((p) => p.id === id);
      btn.textContent = isConfigured ? `${WELCOME_PROVIDERS.find((p) => p.id === id)?.label ?? id} ✓` : WELCOME_PROVIDERS.find((p) => p.id === id)?.label ?? id;
    }
  }

  updateMarks(appState.configuredProviders.value);
  scope.add(appState.configuredProviders.subscribe(updateMarks));

  return section;
}

/** Link al pie: "¿Necesitas ayuda?" — abre la doc de pi en una
 *  nueva pestaña. Por ahora apunta a pi.dev/docs, que es la doc
 *  oficial del sidecar. Cuando tengamos docs propias de xi, las
 *  ponemos primero. */
function renderHelpLink(): HTMLElement {
  const link = document.createElement("a");
  link.className = "welcome-help-link";
  link.href = "https://pi.dev/docs";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "¿Necesitas ayuda? →";
  return link;
}

function renderCta(error: Signal<string | null>): HTMLElement {
  const button = document.createElement("button");
  button.className = "welcome-cta";

  const btnIcon = icon("folder-open", { size: 20 });
  button.append(btnIcon, " Selecciona una carpeta primero");

  // El handler captura el error y lo muestra en el banner. No
  // navegamos a #/chat — eso pasa solo si `openProject` setea
  // `appState.workingDir`, lo cual es detectado por la suscripción
  // en `WelcomePage`.
  button.addEventListener("click", async () => {
    try {
      await pickAndOpenProject();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  });

  return button;
}

function renderRecentsSection(scope: Scope, error: Signal<string | null>): HTMLElement {
  const section = document.createElement("div");
  section.className = "welcome-recents";

  const title = document.createElement("h2");
  title.className = "welcome-recents-title";
  title.textContent = "O abre un proyecto reciente";
  section.append(title);

  const grid = document.createElement("div");
  grid.className = "recents-grid";

  const renderGrid = (recents: Recent[]): void => {
    if (recents.length === 0) {
      section.style.display = "none";
      grid.replaceChildren();
      return;
    }
    section.style.display = "flex";
    grid.replaceChildren(...recents.map((r) => renderRecentCard(r, error)));
  };

  // Render inicial. Si la signal está vacía (caso primera vez),
  // intentamos cargar — esto es un fallback por si `main.ts` no
  // populó la signal antes del primer render (no debería pasar,
  // pero defense in depth).
  const initial = appState.recents.value;
  if (initial.length === 0) {
    getRecents()
      .then((recents) => {
        appState.recents.value = recents;
      })
      .catch((err) => {
        // Si falla la carga, no rompemos la welcome. La sección
        // queda oculta (sin recientes).
        console.error("Failed to load recents in welcome:", err);
      });
  }

  renderGrid(initial);
  scope.add(appState.recents.subscribe(renderGrid));

  section.append(grid);
  return section;
}

// ───────────────────────────────────────────────────────
// renderRecentCard — extraído para no anidar el map dentro de 4 niveles
// ───────────────────────────────────────────────────────

function renderRecentCard(recent: Recent, error: Signal<string | null>): HTMLElement {
  const card = document.createElement("button");
  card.className = "recent-card";
  card.dataset.path = recent.path;

  const name = document.createElement("div");
  name.className = "recent-name";
  name.textContent = recent.name;
  card.append(name);

  const path = document.createElement("div");
  path.className = "recent-path";
  path.textContent = truncatePath(recent.path);
  path.title = recent.path;
  card.append(path);

  const time = document.createElement("div");
  time.className = "recent-time";
  time.textContent = formatRelativeTime(recent.lastOpened);
  card.append(time);

  card.addEventListener("click", async () => {
    try {
      await openProject(recent.path);
      // La navegación a #/chat la dispara la suscripción a
      // workingDir cuando openProject setea el cwd.
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  });

  return card;
}

// ───────────────────────────────────────────────────────
// Helpers puros — testeables, sin DOM
// ───────────────────────────────────────────────────────

/**
 * Formatea un timestamp Unix (ms) como texto relativo en español:
 * "hace 2 días", "hace 3 sem", "hace 1 mes". Granularidad decreciente:
 * minutos → horas → días → semanas → meses.
 */
function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} día${days > 1 ? "s" : ""}`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `hace ${weeks} sem`;

  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? "es" : ""}`;
}

/**
 * Trunca un path absoluto para mostrarlo en una card. Si el path es
 * más largo que `maxLen`, retorna los últimos `maxLen` caracteres con
 * `…` al inicio. Si entra entero, lo retorna igual.
 */
function truncatePath(fullPath: string, maxLen = 40): string {
  if (fullPath.length <= maxLen) return fullPath;
  return "…" + fullPath.slice(-(maxLen - 1));
}
