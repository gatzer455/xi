/**
 * sidebar.ts — Panel lateral con logo, carpeta de trabajo, sesiones y settings.
 *
 * Capa 1 (rendering): produce un `aside` y devuelve el HTMLElement. Las
 * suscripciones a `appState` se registran dentro de la función y se quedan
 * vivas mientras el sidebar esté montado.
 *
 * El callback del botón de carpeta delega en `selectWorkdir`. Esa función
 * existe para aplanar la lógica y mantener el `addEventListener` en un
 * solo nivel. Sin la extracción, el handler tenía cuatro niveles de
 * anidación (try → if selected → if typeof → body) que violaban la regla
 * de code-style sobre profundidad máxima.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { appState } from '../lib/state.ts';
import { navigate } from '../router.ts';
import { startPi, stopPi, newPiSession } from '../lib/pi/index.ts';

export function Sidebar(): HTMLElement {
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';

  sidebar.append(renderHeader());
  sidebar.append(renderWorkdirSection());
  sidebar.append(renderSessionsList());
  sidebar.append(renderFooter());

  return sidebar;
}

// ───────────────────────────────────────────────────────
// Secciones — cada una devuelve un HTMLElement listo para append
// ───────────────────────────────────────────────────────

function renderHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'sidebar-header';

  const logo = document.createElement('span');
  logo.className = 'sidebar-logo';
  logo.textContent = 'xi';
  header.append(logo);

  // El botón "Nuevo" llama a `newPiSession` de Tauri. Si la sesión
  // anterior tenía estado, lo limpiamos antes de navegar.
  const newChatBtn = document.createElement('button');
  newChatBtn.className = 'sidebar-new-chat';
  newChatBtn.textContent = '+ Nuevo';
  newChatBtn.addEventListener('click', async () => {
    try {
      await newPiSession();
      appState.messages.value = [];
      navigate('#/chat');
    } catch (err) {
      console.error('Error creating new session:', err);
    }
  });
  header.append(newChatBtn);

  // Link a la lista completa de sesiones (Etapa 4). Es secundario
  // respecto a "+ Nuevo" — solo abre la página de gestión.
  const viewAllBtn = document.createElement('button');
  viewAllBtn.className = 'sidebar-view-all';
  viewAllBtn.textContent = 'Ver todas';
  viewAllBtn.addEventListener('click', () => navigate('#/sessions'));
  header.append(viewAllBtn);

  return header;
}

function renderWorkdirSection(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'sidebar-workdir';
  section.style.cssText = 'padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border);';

  const button = document.createElement('button');
  button.style.cssText = 'width: 100%; text-align: left; font-size: var(--text-xs); color: var(--color-text-muted); padding: var(--space-2) 0; display: flex; align-items: center; gap: var(--space-2);';

  const icon = document.createElement('span');
  icon.textContent = '📁';
  button.append(icon);

  const label = document.createElement('span');
  label.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
  button.append(label);

  appState.workingDir.subscribe((dir) => {
    if (dir) {
      label.textContent = dir.split('/').pop() || dir;
      button.title = dir;
    } else {
      label.textContent = 'Abrir carpeta de trabajo...';
      button.title = '';
    }
  });

  button.addEventListener('click', () => {
    selectWorkdir().catch((err) => {
      console.error('Error opening folder:', err);
    });
  });

  section.append(button);
  return section;
}

function renderSessionsList(): HTMLElement {
  const list = document.createElement('div');
  list.className = 'sidebar-sessions';

  // Muestra el nombre de la sesión activa, o un fallback si no hay.
  // Se suscribe a `appState.session` para reflejar switches de la página
  // /sessions o el botón "+ Nuevo".
  const item = document.createElement('div');
  item.className = 'session-item active';

  const renderItem = (session: typeof appState.session.value): void => {
    if (session?.name) {
      item.textContent = session.name;
      item.title = session.name;
    } else if (session?.file) {
      // Sesión sin nombre (recién creada): mostrar nombre del archivo
      const basename = session.file.split('/').pop() ?? 'sesión';
      item.textContent = basename;
      item.title = session.file;
    } else {
      item.textContent = 'Sin sesión activa';
      item.title = '';
    }
  };

  renderItem(appState.session.value);
  appState.session.subscribe(renderItem);

  list.append(item);
  return list;
}

function renderFooter(): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'sidebar-settings';
  settingsBtn.innerHTML = '⚙ Configuración';
  settingsBtn.addEventListener('click', () => navigate('#/settings'));
  footer.append(settingsBtn);

  return footer;
}

// ───────────────────────────────────────────────────────
// selectWorkdir — helper privado, no se exporta
// ───────────────────────────────────────────────────────

/**
 * Abre el diálogo nativo de selección de carpeta y reinicia pi en el
 * directorio elegido.
 *
 * El orden importa: detenemos pi antes de cambiar `appState.workingDir`.
 * pi lee archivos del cwd durante su ejecución, y un cambio brusco lo
 * dejaría con un estado inconsistente. Matar primero, mutar después,
 * arrancar al final.
 */
async function selectWorkdir(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Seleccionar carpeta de trabajo',
  });
  if (typeof selected !== 'string') return;

  await stopPi();
  appState.workingDir.value = selected;
  appState.messages.value = [];
  await startPi(selected);
}
