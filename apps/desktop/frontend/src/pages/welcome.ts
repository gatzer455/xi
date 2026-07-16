/**
 * welcome.ts — Pantalla de bienvenida y proyectos recientes (Etapa 5+9).
 *
 * Es la ruta default del router (reemplaza a `#/chat`). Se muestra
 * cuando xi arranca sin workingDir, o cuando el usuario hace click en
 * "Cambiar de proyecto" desde la sidebar.
 */

import { signal, type Signal } from "xi-ui/lib/signal.ts";
import { createScope, type Scope, type Page } from "xi-ui/lib/scope.ts";
import { appState } from "xi-ui/lib/state.ts";
import { pickAndOpenProject, openProject } from "../lib/workdir.ts";
import { navigate } from "xi-ui/lib/nav.ts";
import { getRecents } from "../lib/pi/index.ts";
import type { Recent } from "../lib/pi/index.ts";
import { loadAuthStatus } from "../lib/auth-status.ts";
import { icon } from "xi-ui/lib/icons.ts";

export function WelcomePage(): Page {
  const root = document.createElement("div");
  root.className = "welcome-page";
  const scope = createScope();

  const error = signal<string | null>(null);

  root.append(renderErrorBanner(scope, error));
  root.append(renderHeader());
  root.append(renderAuthBanner(scope));
  root.append(renderCta(error));
  root.append(renderRecentsSection(scope, error));
  root.append(renderHelpLink());

  void loadAuthStatus();

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

  const iconImg = document.createElement("img");
  iconImg.className = "welcome-icon";
  iconImg.src = "xi-icon.svg";
  iconImg.alt = "Xi";
  header.append(iconImg);

  const subtitle = document.createElement("p");
  subtitle.className = "welcome-subtitle";
  subtitle.textContent =
    "Xi es un asistente de inteligencia artificial. Abre un proyecto y pídele lo que necesites: " +
    "redactar documentos, analizar archivos, responder preguntas, lo que necesites.";
  header.append(subtitle);

  return header;
}

function renderAuthBanner(scope: Scope): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "welcome-auth-banner";
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

  scope.add(
    appState.hasAnyProvider.subscribe((hasAny) => {
      banner.style.visibility = hasAny ? "hidden" : "visible";
    }),
  );

  return banner;
}

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

  const initial = appState.recents.value;
  if (initial.length === 0) {
    getRecents()
      .then((recents) => {
        appState.recents.value = recents;
      })
      .catch((err) => {
        console.error("Failed to load recents in welcome:", err);
      });
  }

  renderGrid(initial);
  scope.add(appState.recents.subscribe(renderGrid));

  section.append(grid);
  return section;
}

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
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  });

  return card;
}

// ───────────────────────────────────────────────────────
// Helpers puros
// ───────────────────────────────────────────────────────

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

function truncatePath(fullPath: string, maxLen = 40): string {
  if (fullPath.length <= maxLen) return fullPath;
  return "…" + fullPath.slice(-(maxLen - 1));
}
