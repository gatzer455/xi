/**
 * settings.ts — Página de configuración (Capa 1)
 *
 * 5 secciones: Modelo, Razonamiento, Apariencia, Sesión, Acerca de.
 * Cada sección se renderiza con un helper privado (extracción,
 * max 3 niveles de anidación). Cambios de tema/font son UI-only
 * (localStorage + atributo al DOM). Cambios de modelo/thinking
 * pasan por RPC de pi (ver lib/pi/tauri-commands.ts).
 *
 * Reglas de code-style aplicadas:
 * - Guard clauses: renderModelSelect tiene 3 estados (loading/error/ready)
 *   con early returns, no if/else anidados.
 * - Extracción: createSection, renderSegmented<T>, renderModelSelect
 *   son helpers top-level.
 * - Parse, don't validate: ThinkingLevel discriminado.
 * - Logging: errores de RPC se propagan (logged via loggedInvoke).
 */

import { appState, type ThemeMode, type FontSize, type ThinkingLevel } from '../lib/state.ts';
import { signal } from '../lib/signal.ts';
import { navigate } from '../lib/nav.ts';
import {
  setModel,
  setThinkingLevel,
  getAvailableModels,
} from '../lib/pi/tauri-commands.ts';
import {
  applyThemeToDOM,
  applyFontToDOM,
  saveTheme,
  saveFontSize,
} from '../lib/settings-storage.ts';
import {
  checkForUpdate,
  installAndRelaunch,
} from '../lib/updater.ts';

// ═══════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════

export function SettingsPage(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'settings-page';

  // Disparar la carga de modelos al primer mount, solo si la lista
  // está vacía Y no estamos ya cargando (main.ts puede haber
  // disparado el request antes). `loadModels` es fire-and-forget
  // (la respuesta llega por eventos al state-sync) e inicia un
  // timer de 5s para mostrar error si pi no responde.
  if (
    appState.availableModels.value.length === 0 &&
    !modelsLoadAttempted &&
    !modelsLoading.value
  ) {
    modelsLoadAttempted = true;
    loadModels();
  }

  // Back button: el shell del top bar sigue siendo el navegador principal.
  const back = document.createElement('button');
  back.className = 'settings-back';
  back.textContent = '← Volver al chat';
  back.addEventListener('click', () => navigate('chat'));
  page.append(back);

  const title = document.createElement('h1');
  title.className = 'settings-title';
  title.textContent = 'Configuración';
  page.append(title);

  // Las 5 secciones en orden.
  page.append(renderModelSection());
  page.append(renderThinkingSection());
  page.append(renderAppearanceSection());
  page.append(renderSessionSection());
  page.append(renderUpdateSection());
  page.append(renderAboutSection());

  return page;
}

// ═══════════════════════════════════════════════════════
// Secciones
// ═══════════════════════════════════════════════════════

function renderModelSection(): HTMLElement {
  // El control es un wrapper estable (`settings-row`) cuyo innerHTML
  // se reemplaza en cada repaint. Las suscripciones a modelsLoading,
  // modelsError, availableModels y currentModel disparan el repaint.
  // Así, cuando loadModels termina, la UI se actualiza sin tener que
  // remontar la página entera.
  const row = document.createElement('div');
  row.className = 'settings-row';

  const repaint = (): void => {
    row.replaceChildren(buildModelControl());
  };
  repaint();

  // Suscripciones: cada cambio de state relevante re-pinta el control.
  modelsLoading.subscribe(repaint);
  modelsError.subscribe(repaint);
  appState.availableModels.subscribe(() => repaint());
  appState.currentModel.subscribe(() => repaint());

  return createSection({
    title: 'Modelo',
    description: 'Proveedor y modelo de lenguaje que usa pi.',
    control: row,
  });
}

/** Construye el control interior del modelo (4 estados).
 *  Se llama desde renderModelSection y se reemplaza in-place. */
function buildModelControl(): HTMLElement {
  if (modelsLoading.value) return renderModelLoading();
  if (modelsError.value) return renderModelError();
  if (appState.availableModels.value.length === 0) return renderModelEmpty();
  return renderModelSelectReady();
}

/** Estado especial: pi respondió pero no hay providers configurados.
 *  Es diferente del error — no es un fallo transitorio, es una config
 *  que el usuario tiene que hacer en pi. */
function renderModelEmpty(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const msg = document.createElement('span');
  msg.className = 'settings-empty';
  msg.textContent = 'No hay providers configurados en pi.';
  row.append(msg);

  return row;
}

function renderThinkingSection(): HTMLElement {
  return createSection({
    title: 'Razonamiento',
    description: 'Cuánto esfuerzo dedica pi a pensar antes de responder.',
    control: renderSegmented<ThinkingLevel>(
      [
        { value: 'off',     label: 'Off' },
        { value: 'minimal', label: 'Mínimo' },
        { value: 'low',     label: 'Bajo' },
        { value: 'medium',  label: 'Medio' },
        { value: 'high',    label: 'Alto' },
        { value: 'xhigh',   label: 'Máx' },
      ],
      appState.thinkingLevel.value,
      (v) => { void setThinkingLevel(v); },
    ),
  });
}

function renderAppearanceSection(): HTMLElement {
  // "Apariencia" agrupa tema y font en un solo bloque. Armamos el
  // contenedor de controles acá (sin pasar por createSection) y lo
  // pasamos como `control` directo.
  const controls = document.createElement('div');
  controls.className = 'settings-appearance-controls';

  // Sub-control: tema
  const themeLabel = document.createElement('div');
  themeLabel.className = 'settings-sublabel';
  themeLabel.textContent = 'Tema';
  controls.append(themeLabel);

  controls.append(
    renderSegmented<ThemeMode>(
      [
        { value: 'dark',   label: 'Oscuro' },
        { value: 'light',  label: 'Claro' },
        { value: 'system', label: 'Sistema' },
      ],
      appState.theme.value,
      (theme) => {
        appState.theme.value = theme;
        applyThemeToDOM(theme);
        saveTheme(theme);
      },
    ),
  );

  // Sub-control: font
  const fontLabel = document.createElement('div');
  fontLabel.className = 'settings-sublabel';
  fontLabel.textContent = 'Fuente';
  controls.append(fontLabel);

  controls.append(
    renderSegmented<FontSize>(
      [
        { value: 'small',  label: 'Pequeña' },
        { value: 'medium', label: 'Mediana' },
        { value: 'large',  label: 'Grande' },
      ],
      appState.fontSize.value,
      (size) => {
        appState.fontSize.value = size;
        applyFontToDOM(size);
        saveFontSize(size);
      },
    ),
  );

  return createSection({
    title: 'Apariencia',
    description: 'Tema y tamaño de la fuente.',
    control: controls,
  });
}

function renderSessionSection(): HTMLElement {
  const sessionValue = document.createElement('span');
  sessionValue.className = 'settings-value';
  sessionValue.textContent = 'ninguna';

  const paint = (session: { id: string } | null): void => {
    sessionValue.textContent = session ? session.id.slice(0, 8) + '…' : 'ninguna';
  };
  paint(appState.session.value);
  appState.session.subscribe(paint);

  const row = document.createElement('div');
  row.className = 'settings-row';
  row.append(label('Sesión actual'));
  row.append(sessionValue);

  return createSection({
    title: 'Sesión',
    description: 'Identificador de la conversación activa.',
    control: row,
  });
}

function renderAboutSection(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  row.append(label('Versión'));
  row.append(value('0.1.0'));

  return createSection({
    title: 'Acerca de',
    description: 'Información de la aplicación.',
    control: row,
  });
}

// ═══════════════════════════════════════════════════════
// Sección de update (Etapa 7)
// ═══════════════════════════════════════════════════════

function renderUpdateSection(): HTMLElement {
  // El control es un wrapper estable con suscripciones. La signal
  // updateStatus determina qué se ve (status text + botones).
  // El resto se actualiza en cada repaint.
  const row = document.createElement('div');
  row.className = 'settings-row settings-update-row';

  const statusValue = document.createElement('span');
  statusValue.className = 'settings-value settings-update-status';
  row.append(label('Actualización'));
  row.append(statusValue);

  const actions = document.createElement('div');
  actions.className = 'settings-update-actions';
  row.append(actions);

  // Helper: arma la UI de status + botones según el estado.
  // Extraído para evitar 4 niveles de anidación con if/else anidados.
  const repaint = (): void => {
    statusValue.textContent = statusText();
    statusValue.className = `settings-value settings-update-status settings-update-status--${appState.updateStatus.value}`;
    actions.replaceChildren();
    for (const btn of actionButtons()) {
      actions.append(btn);
    }
  };

  // Suscripción a las 3 signals que afectan la UI.
  // (updateError no se renderiza directo; lo lee statusText).
  repaint();
  appState.updateStatus.subscribe(repaint);
  appState.updateReady.subscribe(repaint);
  appState.updateError.subscribe(repaint);
  appState.updateDismissed.subscribe(repaint);

  return createSection({
    title: 'Actualización',
    description: 'Versiones nuevas de xi. La app puede actualizarse sola en background.',
    control: row,
  });
}

/** Texto que ve el user en la columna "Actualización". Resume el
 *  estado de updateStatus en lenguaje natural. */
function statusText(): string {
  switch (appState.updateStatus.value) {
    case 'idle':         return 'Al día';
    case 'checking':     return 'Buscando...';
    case 'downloading':  return `Descargando v${appState.updateReady.value?.version ?? ''}...`;
    case 'ready':        return `v${appState.updateReady.value?.version ?? ''} lista para aplicar`;
    case 'error':        return `Error: ${appState.updateError.value ?? 'desconocido'}`;
  }
}

/** Botones a mostrar en la columna de acciones, según el estado.
 *  Retorna un array (0, 1 o 2 botones). */
function actionButtons(): HTMLElement[] {
  const status = appState.updateStatus.value;
  const buttons: HTMLElement[] = [];

  // Botón "Buscar actualización": siempre presente excepto durante
  // checking/downloading (no tiene sentido re-disparar).
  const busy = status === 'checking' || status === 'downloading';
  const checkBtn = document.createElement('button');
  checkBtn.className = 'settings-button';
  checkBtn.textContent = busy ? 'Buscando...' : 'Buscar actualización';
  checkBtn.disabled = busy;
  checkBtn.addEventListener('click', () => { void checkForUpdate(); });
  buttons.push(checkBtn);

  // Botón "Reiniciar para aplicar": solo si hay update ready y
  // el user no lo dismissed en el banner.
  if (status === 'ready' && !appState.updateDismissed.value) {
    const restartBtn = document.createElement('button');
    restartBtn.className = 'settings-button settings-button--primary';
    restartBtn.textContent = 'Reiniciar para aplicar';
    restartBtn.addEventListener('click', () => { void installAndRelaunch(); });
    buttons.push(restartBtn);
  }

  return buttons;
}

// ═══════════════════════════════════════════════════════
// Render de modelo: 3 estados (loading/error/ready)
// ═══════════════════════════════════════════════════════

// Estado del dropdown. `modelsLoading` y `modelsError` son module-level
// (viven en el módulo) para sobrevivir navegaciones. Se sincronizan
// con `appState.availableModels` desde main.ts.
//
// `modelsLoading` arranca en true (desconocemos si pi está corriendo
// al cargar este módulo). `loadModels` lo setea a false cuando termina.
// Si main.ts ya populó la lista antes, `loadModels` la respeta (no
// re-carga, solo no marca como loading si ya hay modelos).
const modelsLoading = signal(true);
const modelsError = signal<string | null>(null);

// Si main.ts ya populó la lista (caso pi corriendo al inicio), no
// necesitamos "loading". Esta expresión se ejecuta al cargar el módulo.
if (appState.availableModels.value.length > 0) {
  modelsLoading.value = false;
}

// Cuando state-sync popula la signal (incluso con []), cancelamos
// el loading. Sin esto, el timer global de 5s podría mostrar un
// error falso si pi respondió a tiempo con lista vacía.
appState.availableModels.subscribe(() => {
  modelsLoading.value = false;
});

// `modelsLoadAttempted` previene loops: si la lista está vacía y pi
// no está corriendo, una vez que intentamos y fallamos, no reintentamos
// en cada mount de SettingsPage. El botón "Reintentar" en el estado
// de error permite al usuario forzar un retry manual.
//
// IMPORTANTE: este flag NO se setea si `modelsLoading` ya es true
// (porque main.ts disparó la carga). Eso evita re-disparar requests
// si el usuario entra a settings antes de que pi responda.
let modelsLoadAttempted = false;

function renderModelLoading(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const select = document.createElement('select');
  select.className = 'settings-select';
  select.disabled = true;
  const opt = document.createElement('option');
  opt.textContent = 'Cargando modelos…';
  select.append(opt);
  row.append(select);

  return row;
}

function renderModelError(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const msg = document.createElement('span');
  msg.className = 'settings-error';
  msg.textContent = `Error: ${modelsError.value}`;
  row.append(msg);

  const retry = document.createElement('button');
  retry.className = 'settings-button';
  retry.textContent = 'Reintentar';
  retry.addEventListener('click', () => { void loadModels(); });
  row.append(retry);

  return row;
}

function renderModelSelectReady(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const select = document.createElement('select');
  select.className = 'settings-select';

  const current = appState.currentModel.value;
  const available = appState.availableModels.value;

  // Si el modelo actual no está en la lista, lo mergeamos al tope como
  // "no disponible" (D6 del design). El usuario puede ver qué modelo
  // está usando y cambiar a uno disponible.
  const currentNotInList = current && !available.some(
    m => m.provider === current.provider && m.id === current.id,
  );

  if (currentNotInList && current) {
    const opt = document.createElement('option');
    opt.value = `${current.provider}/${current.id}`;
    opt.textContent = `${current.provider}/${current.id} (no disponible)`;
    opt.disabled = true;
    opt.selected = true;
    select.append(opt);
  }

  for (const model of available) {
    const opt = document.createElement('option');
    opt.value = `${model.provider}/${model.id}`;
    opt.textContent = `${model.provider}/${model.id}`;
    if (current && model.provider === current.provider && model.id === current.id) {
      opt.selected = true;
    }
    select.append(opt);
  }

  select.addEventListener('change', () => {
    const value = select.value;  // formato: "provider/modelId"
    const slashIdx = value.indexOf('/');
    if (slashIdx === -1) return;
    const provider = value.slice(0, slashIdx);
    const modelId = value.slice(slashIdx + 1);
    void setModel(provider, modelId);
  });

  row.append(select);
  return row;
}

/** Pide la lista de modelos a pi. NO espera la respuesta: el sidecar
 *  de pi responde via eventos, que state-sync procesa y popula
 *  `appState.availableModels`. La signal se suscribe y re-pinta
 *  el control automaticamente.
 *
 *  Timeout de seguridad: si en 5s no llega respuesta (pi caído, o
 *  no hay providers configurados y pi responde con error), mostramos
 *  un mensaje útil. Sin esto, el usuario queda en "Cargando…"
 *  indefinidamente. */
function loadModels(): void {
  modelsLoading.value = true;
  modelsError.value = null;
  getAvailableModels();

  // Si en 5s no se popula la lista y seguimos en loading, mostrar
  // un mensaje útil. Si state-sync ya populó algo (caso pi
  // respondio con [] por falta de providers), el repaint via la
  // suscripción en `renderModelSection` ocurrira primero.
  setTimeout(() => {
    if (modelsLoading.value) {
      // Chequeamos: si state-sync ya populó algo entre medio, no
      // mostramos error. Pero si seguimos en loading despues de 5s,
      // probablemente pi no está corriendo o no hay providers.
      if (appState.availableModels.value.length === 0) {
        modelsError.value = 'No se pudo obtener la lista. Asegurate de que pi esté corriendo y tengas al menos un provider configurado.';
        modelsLoading.value = false;
      } else {
        // Hay modelos — el state-sync populó; cancelamos el loading.
        modelsLoading.value = false;
      }
    }
  }, 5000);
}

/** Timer para el caso en que main.ts disparó el request pero pi nunca
 *  respondió. Si la signal se popula antes de los 5s (state-sync
 *  respondió, o respondió con []), el repaint de renderModelSection
 *  setea modelsLoading = false y este timer no hace nada. */
const initialLoadTimeout = setTimeout(() => {
  if (modelsLoading.value && appState.availableModels.value.length === 0) {
    modelsError.value = 'No se pudo obtener la lista. Asegurate de que pi esté corriendo y tengas al menos un provider configurado.';
    modelsLoading.value = false;
  }
}, 5000);
// En TS estricto, las variables top-level usadas solo en setTimeout
// requieren la anotación o se usan. Referencia explícita:
void initialLoadTimeout;

// ═══════════════════════════════════════════════════════
// Helpers de DOM (extracción)
// ═══════════════════════════════════════════════════════

interface SectionSpec {
  title: string;
  description: string;
  control: HTMLElement;
}

/** Shell estándar de una sección. */
function createSection(spec: SectionSpec): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const title = document.createElement('h2');
  title.className = 'settings-section-title';
  title.textContent = spec.title;
  section.append(title);

  const desc = document.createElement('p');
  desc.className = 'settings-section-desc';
  desc.textContent = spec.description;
  section.append(desc);

  const control = document.createElement('div');
  control.className = 'settings-control';
  control.append(spec.control);
  section.append(control);

  return section;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
}

/** Botones en fila horizontal. T genérico discriminado: typos en
 *  compilación, no en runtime. */
function renderSegmented<T extends string>(
  options: ReadonlyArray<SegmentedOption<T>>,
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'settings-segmented';
  group.setAttribute('role', 'group');

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-segmented-btn';
    btn.textContent = opt.label;
    if (opt.value === current) {
      btn.classList.add('settings-segmented-btn--active');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.setAttribute('aria-pressed', 'false');
    }
    btn.addEventListener('click', () => {
      // Limpiar el activo anterior y aplicar el nuevo.
      for (const other of group.querySelectorAll<HTMLElement>('.settings-segmented-btn')) {
        other.classList.remove('settings-segmented-btn--active');
        other.setAttribute('aria-pressed', 'false');
      }
      btn.classList.add('settings-segmented-btn--active');
      btn.setAttribute('aria-pressed', 'true');
      onChange(opt.value);
    });
    group.append(btn);
  }

  return group;
}

function label(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'settings-label';
  el.textContent = text;
  return el;
}

function value(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'settings-value';
  el.textContent = text;
  return el;
}
