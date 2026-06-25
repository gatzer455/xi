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

import { signal } from '../lib/signal.ts';
import { createScope, type Scope, type Page } from '../lib/scope.ts';
import { appState } from '../lib/state.ts';
import { pickAndOpenProject, openProject } from '../lib/workdir.ts';
import { navigate } from '../lib/nav.ts';
import { getRecents } from '../lib/pi/index.ts';
import type { Recent } from '../lib/pi/index.ts';
import { loadAuthStatus } from '../lib/auth-status.ts';
import { icon } from '../lib/icons.ts';

// Signal local de la welcome. No se exporta; vive solo mientras la
// página está montada. Si `openProject` falla, mostramos el mensaje.
const error = signal<string | null>(null);

export function WelcomePage(): Page {
  const root = document.createElement('div');
  root.className = 'welcome-page';
  const scope = createScope();

  root.append(renderErrorBanner(scope));
  root.append(renderHeader());
  root.append(renderWelcomeHeader());
  root.append(renderCta());
  root.append(renderRecentsSection(scope));
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
  scope.add(appState.workingDir.subscribe((dir) => {
    if (dir && dir !== initialDir) {
      navigate('sessions');
    }
  }));

  return { root, dispose: () => scope.dispose() };
}

// ───────────────────────────────────────────────────────
// Secciones
// ───────────────────────────────────────────────────────

function renderErrorBanner(scope: Scope): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'welcome-error';
  banner.style.display = 'none';

  scope.add(error.subscribe((msg) => {
    if (msg) {
      banner.textContent = msg;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }));

  return banner;
}

function renderHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'welcome-header';

  const icon = document.createElement('img');
  icon.className = 'welcome-icon';
  icon.src = 'xi-icon.svg';
  icon.alt = 'Xi';
  header.append(icon);

  const subtitle = document.createElement('p');
  subtitle.className = 'welcome-subtitle';
  subtitle.textContent =
    'Xi es un asistente de inteligencia artificial. Abre un proyecto y pídele lo que necesites: ' +
    'redactar documentos, analizar archivos, responder preguntas, lo que necesites.';
  header.append(subtitle);

  return header;
}

/** Link al pie: "¿Necesitas ayuda?" — abre la doc de pi en una
 *  nueva pestaña. Por ahora apunta a pi.dev/docs, que es la doc
 *  oficial del sidecar. Cuando tengamos docs propias de xi, las
 *  ponemos primero. */
function renderHelpLink(): HTMLElement {
  const link = document.createElement('a');
  link.className = 'welcome-help-link';
  link.href = 'https://pi.dev/docs';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '¿Necesitas ayuda? →';
  return link;
}

function renderCta(): HTMLElement {
  const button = document.createElement('button');
  button.className = 'welcome-cta';

  const btnIcon = icon('folder-open', { size: 20 });
  button.append(btnIcon, ' Seleccioná una carpeta primero');

  // El handler captura el error y lo muestra en el banner. No
  // navegamos a #/chat — eso pasa solo si `openProject` setea
  // `appState.workingDir`, lo cual es detectado por la suscripción
  // en `WelcomePage`.
  button.addEventListener('click', async () => {
    try {
      await pickAndOpenProject();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  });

  return button;
}

function renderRecentsSection(scope: Scope): HTMLElement {
  const section = document.createElement('div');
  section.className = 'welcome-recents';

  const title = document.createElement('h2');
  title.className = 'welcome-recents-title';
  title.textContent = 'O abre un proyecto reciente';
  section.append(title);

  const grid = document.createElement('div');
  grid.className = 'recents-grid';

  const renderGrid = (recents: Recent[]): void => {
    if (recents.length === 0) {
      section.style.display = 'none';
      grid.replaceChildren();
      return;
    }
    section.style.display = 'flex';
    grid.replaceChildren(...recents.map(renderRecentCard));
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
        console.error('Failed to load recents in welcome:', err);
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

function renderRecentCard(recent: Recent): HTMLElement {
  const card = document.createElement('button');
  card.className = 'recent-card';
  card.dataset.path = recent.path;

  const name = document.createElement('div');
  name.className = 'recent-name';
  name.textContent = recent.name;
  card.append(name);

  const path = document.createElement('div');
  path.className = 'recent-path';
  path.textContent = truncatePath(recent.path);
  path.title = recent.path;
  card.append(path);

  const time = document.createElement('div');
  time.className = 'recent-time';
  time.textContent = formatRelativeTime(recent.lastOpened);
  card.append(time);

  card.addEventListener('click', async () => {
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

  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} día${days > 1 ? 's' : ''}`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `hace ${weeks} sem`;

  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

/**
 * Trunca un path absoluto para mostrarlo en una card. Si el path es
 * más largo que `maxLen`, retorna los últimos `maxLen` caracteres con
 * `…` al inicio. Si entra entero, lo retorna igual.
 */
function truncatePath(fullPath: string, maxLen = 40): string {
  if (fullPath.length <= maxLen) return fullPath;
  return '…' + fullPath.slice(-(maxLen - 1));
}
