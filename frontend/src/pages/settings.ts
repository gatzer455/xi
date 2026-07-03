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
import { createScope, type Scope, type Page } from '../lib/scope.ts';
import { navigate } from '../lib/nav.ts';
import {
  setModel,
  setThinkingLevel,
  getAvailableModels,
  getPiVersion,
  getPiState,
  setApiKey,
  testApiKey,
  getApiKey,
  deleteApiKey,
  type ProviderInfo,
} from '../lib/pi/tauri-commands.ts';
import {
  getExaConfig,
  getExaApiKey,
  setExaApiKey,
  deleteExaApiKey,
  testExaApiKey,
  getApproveRules,
  setApproveRules,
  type ExaConfigStatus,
  type ApproveRules,
} from '../lib/pi/tauri-commands.ts';
import { ensurePiRunning } from '../lib/pi/index.ts';
import { loadAuthStatus } from '../lib/auth-status.ts';
import {
  applyThemeToDOM,
  applyFontToDOM,
  saveTheme,
  saveFontSize,
} from '../lib/settings-storage.ts';
import {
  checkForUpdate,
  installAndRelaunch,
  isUpdaterAvailable,
} from '../lib/updater.ts';

// ═══════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════

export function SettingsPage(): Page {
  const root = document.createElement('div');
  root.className = 'settings-page';
  const scope = createScope();

  // Disparar la carga de modelos al primer mount
  // Solo cargar modelos si hay una sesión activa (hay workingDir).
  // Sin sesión, pi no puede arrancar y getAvailableModels falla.
  // La lista de modelos se usa en la context bar del chat, no en Settings.
  if (
    appState.workingDir.value &&
    appState.availableModels.value.length === 0 &&
    !modelsLoadAttempted &&
    !modelsLoading.value
  ) {
    modelsLoadAttempted = true;
    loadModels();
  }

  void getPiVersion().then((version) => {
    appState.piVersion.value = version;
  });

  void loadAuthStatus();

  if (appState.workingDir.value) {
    void ensurePiRunning().then(() => getPiState()).catch(() => {});
  }

  // Back button
  const back = document.createElement('button');
  back.className = 'settings-back';
  back.textContent = '← Volver';
  back.addEventListener('click', () => {
    navigate(appState.previousView.value);
  });
  root.append(back);

  const title = document.createElement('h1');
  title.className = 'settings-title';
  title.textContent = 'Configuración';
  root.append(title);

  // ── Tabs ────────────────────────────────────────────────
  const tabs = renderSettingsTabs(scope);
  root.append(tabs);

  return { root, dispose: () => scope.dispose() };
}

// ═══════════════════════════════════════════════════════
// Tab navigation
// ═══════════════════════════════════════════════════════

type SettingsTab = 'provider' | 'appearance' | 'extensions' | 'about';

function renderSettingsTabs(scope: Scope): HTMLElement {
  const container = document.createElement('div');
  container.className = 'settings-tabs';

  const activeTab = signal<SettingsTab>('provider');

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'settings-tab-bar';

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'provider', label: 'Proveedor' },
    { id: 'appearance', label: 'Apariencia' },
    { id: 'extensions', label: 'Extensiones' },
    { id: 'about', label: 'Acerca de' },
  ];

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-tab-btn';
    btn.dataset.tab = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => { activeTab.value = tab.id; });
    activeTab.subscribe((id) => {
      btn.classList.toggle('settings-tab-btn--active', id === tab.id);
    });
    tabBar.append(btn);
  }

  container.append(tabBar);

  // Tab content
  const content = document.createElement('div');
  content.className = 'settings-tab-content';

  // Provider tab
  const providerPane = wrapPane(renderProviderSection(scope));
  content.append(providerPane);

  // Appearance tab
  const appearancePane = wrapPane(renderAppearanceSection());
  content.append(appearancePane);

  // Extensions tab
  const extensionsPane = wrapPane(renderExtensionsSection(scope));
  content.append(extensionsPane);

  // About tab (update + session + about)
  const aboutPane = wrapPane(renderUpdateSection(scope));
  aboutPane.append(renderSessionSection(scope));
  aboutPane.append(renderAboutSection(scope));
  content.append(aboutPane);

  // Show/hide panes based on active tab
  const panes = [providerPane, appearancePane, extensionsPane, aboutPane];
  activeTab.subscribe((id) => {
    const idx = tabs.findIndex((t) => t.id === id);
    for (let i = 0; i < panes.length; i++) {
      panes[i].style.display = i === idx ? '' : 'none';
    }
    // Activar el primer tab por defecto
    if (idx === -1) {
      panes[0].style.display = '';
    }
  });

  // Inicializar: mostrar solo provider
  activeTab.value = 'provider';

  container.append(content);
  return container;
}

function wrapPane(content: HTMLElement): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'settings-tab-pane';
  pane.append(content);
  return pane;
}

// ═══════════════════════════════════════════════════════
// Secciones
// ═══════════════════════════════════════════════════════

// Providers que xi soporta en su UI. Cada uno tiene su ID (que va
// al backend y a auth.json) y su label (que ve el user en el
// segmented control). El orden refleja la recomendación del dev
// (opencode-go al tope porque tiene modelos free + suscripción;
// openai al final porque el dev no lo recomienda). El user final
// puede reordenar en una v2 si hace falta.
const SUPPORTED_PROVIDERS = [
  { id: 'opencode-go', label: 'OpenCode Go' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'google', label: 'Google' },
  { id: 'groq', label: 'Groq' },
  { id: 'openai', label: 'OpenAI' },
] as const;

type SupportedProviderId = (typeof SUPPORTED_PROVIDERS)[number]['id'];

const STORAGE_KEY_LAST_PROVIDER = 'xi.lastProvider';

function getLastProvider(): SupportedProviderId {
  const stored = localStorage.getItem(STORAGE_KEY_LAST_PROVIDER);
  if (stored && SUPPORTED_PROVIDERS.some((p) => p.id === stored)) {
    return stored as SupportedProviderId;
  }
  return 'opencode-go';
}

function setLastProvider(id: SupportedProviderId): void {
  localStorage.setItem(STORAGE_KEY_LAST_PROVIDER, id);
}

function renderProviderSection(scope: Scope): HTMLElement {
  // El control es un wrapper estable con suscripciones a las signals.
  // currentProvider vive solo en este closure (no en appState) porque
  // es un setting puramente de UI — localStorage guarda la persistencia.
  // saveStatus es un signal local para el feedback de "Guardado" /
  // "Error" sin repintar toda la sección.
  const control = document.createElement('div');
  control.className = 'settings-provider-control';

  let currentProvider: SupportedProviderId = getLastProvider();
  const saveStatus = signal<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'tested' } | { kind: 'error'; message: string }>({ kind: 'idle' });

  const tabs = renderSegmented<SupportedProviderId>(
    SUPPORTED_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
    currentProvider,
    (id) => {
      currentProvider = id;
      setLastProvider(id);
      saveStatus.value = { kind: 'idle' };
      // Re-pintar el hint porque cambió el provider activo.
      updateProviderUI(appState.configuredProviders.value);
    },
  );
  control.append(tabs);

  // Status: "Tienes X providers configurados" o "No hay providers
  // configurados". Se actualiza via suscripción a la signal.
  const statusText = document.createElement('div');
  statusText.className = 'settings-provider-status';

  // Hint: aparece si el provider activo ya está configurado.
  const keyHint = document.createElement('div');
  keyHint.className = 'settings-provider-keyhint';

  // Helper: retorna la ProviderInfo del provider activo, o undefined
  // si no está configurado. Usado por el hint y el botón Eliminar.
  const findProvider = (list: ReadonlyArray<ProviderInfo>): ProviderInfo | undefined =>
    list.find((p) => p.id === currentProvider);

  // Una sola función que actualiza markers + status + hint + botones
  // de Ver/Eliminar según el provider activo. Se llama al mount, al
  // cambiar configuredProviders, y al cambiar de tab.
  const updateProviderUI = (configured: ReadonlyArray<ProviderInfo>): void => {
    // Markers en los tabs.
    for (const opt of SUPPORTED_PROVIDERS) {
      const btn = tabs.querySelector<HTMLElement>(`[data-value="${opt.id}"]`);
      if (!btn) continue;
      const isConfigured = configured.some((p) => p.id === opt.id);
      btn.textContent = isConfigured ? `${opt.label} ✓` : opt.label;
      btn.classList.toggle('settings-segmented-btn--configured', isConfigured);
    }
    // Status global: contamos los que tienen key editable (hasKey).
    if (configured.length === 0) {
      statusText.textContent = 'No hay providers configurados todavía.';
    } else {
      const editable = configured.filter((p) => p.hasKey).length;
      const total = configured.length;
      if (editable === total) {
        statusText.textContent = `Tienes ${total} provider${total > 1 ? 's' : ''} configurado${total > 1 ? 's' : ''}. Marcados con ✓ abajo.`;
      } else {
        statusText.textContent = `Tienes ${total} provider${total > 1 ? 's' : ''} configurado${total > 1 ? 's' : ''} (${editable} con API key). Marcados con ✓ abajo.`;
      }
    }
    // Hint + placeholder + botones según el provider activo.
    const active = findProvider(configured);
    if (active && active.hasKey) {
      const masked = `sk-***${active.last4 ?? '****'}`;
      keyHint.textContent = `Ya tienes una key guardada (${masked}). Pega una nueva solo si quieres cambiarla.`;
      keyHint.style.display = 'block';
      keyInput.placeholder = `Actual: ${masked} — pega una nueva para cambiar`;
      eyeBtn.style.display = 'inline-block';
      deleteBtn.style.display = 'inline-block';
    } else if (active && !active.hasKey) {
      keyHint.textContent = 'Este provider está configurado con OAuth (no editable desde xi). Usa `pi login` en una terminal para cambiarlo.';
      keyHint.style.display = 'block';
      keyInput.placeholder = 'OAuth — no editable';
      eyeBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
    } else {
      keyHint.textContent = '';
      keyHint.style.display = 'none';
      keyInput.placeholder = 'sk-...';
      eyeBtn.style.display = 'none';
      deleteBtn.style.display = 'none';
    }
  };
  control.append(statusText);

  // Hint: aparece si el provider activo ya está configurado.
  control.append(keyHint);

  // Input de API key: password con botón de ojo.
  const keyRow = document.createElement('div');
  keyRow.className = 'settings-provider-keyrow';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'settings-input settings-provider-keyinput';
  keyInput.placeholder = 'sk-...';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;

  // Botón "ojo" (toggle de visibilidad). Solo visible si el provider
  // activo está configurado (tiene key guardada). Comportamiento:
  //   - Si el input está vacío: trae la key del backend via getApiKey()
  //     y la pone visible. El ícono cambia a "🙈" (ocultar).
  //   - Si el input ya tiene contenido: alterna entre password (oculto)
  //     y text (visible). El ícono cambia entre "👁" y "🙈".
  //   - El ícono refleja el estado actual: ojo abierto = oculto,
  //     mono tapándose = visible.
  // Reemplaza al botón "Ver" original (commit c9b523b) que hacía lo
  // mismo con un botón separado. Ahora es un solo control.
  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'settings-provider-toggle';
  eyeBtn.setAttribute('aria-label', 'Mostrar API key');
  eyeBtn.textContent = '👁';
  eyeBtn.style.display = 'none';
  let isKeyVisible = false;
  eyeBtn.addEventListener('click', async () => {
    if (isKeyVisible) {
      // Ya está visible → limpiar y volver a "👁"
      keyInput.value = '';
      keyInput.type = 'password';
      eyeBtn.textContent = '👁';
      eyeBtn.setAttribute('aria-label', 'Mostrar API key');
      isKeyVisible = false;
      return;
    }
    // Si el input está vacío, traer la key del backend.
    // Si ya tiene algo escrito, no pisamos: solo alternamos visibilidad.
    if (keyInput.value === '') {
      eyeBtn.disabled = true;
      saveStatus.value = { kind: 'idle' };
      const key = await getApiKey(currentProvider);
      eyeBtn.disabled = false;
      if (key === null) {
        saveStatus.value = { kind: 'error', message: 'No se pudo leer la key' };
        return;
      }
      keyInput.value = key;
    }
    keyInput.type = 'text';
    eyeBtn.textContent = '🙈';
    eyeBtn.setAttribute('aria-label', 'Ocultar API key');
    isKeyVisible = true;
  });

  keyRow.append(keyInput, eyeBtn);
  control.append(keyRow);

  // Botones Guardar / Probar / Eliminar + feedback.
  const actions = document.createElement('div');
  actions.className = 'settings-provider-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'settings-btn settings-btn--primary';
  saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      saveStatus.value = { kind: 'error', message: 'Pegá una key antes de guardar' };
      return;
    }
    saveBtn.disabled = true;
    saveStatus.value = { kind: 'idle' };
    try {
      await setApiKey(currentProvider, key);
      saveStatus.value = { kind: 'saved' };
      // Refrescar estado (welcome banderita) + lista de modelos.
      await loadAuthStatus();
      await loadModels();
      // Si estaba visible la key anterior, limpiar y volver al estado oculto.
      if (isKeyVisible) {
        keyInput.value = '';
        keyInput.type = 'password';
        eyeBtn.textContent = '👁';
        eyeBtn.setAttribute('aria-label', 'Mostrar API key');
        isKeyVisible = false;
      }
    } catch (err) {
      saveStatus.value = {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      saveBtn.disabled = false;
    }
  });

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'settings-btn';
  testBtn.textContent = 'Probar';
  testBtn.title = 'Valida la key del input contra el endpoint del provider (no la guardada en disco)';
  testBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      saveStatus.value = { kind: 'error', message: 'Pegá una key antes de probar' };
      return;
    }
    testBtn.disabled = true;
    saveStatus.value = { kind: 'idle' };
    const errMsg = await testApiKey(currentProvider, key);
    if (errMsg === '') {
      saveStatus.value = { kind: 'tested' };
    } else {
      saveStatus.value = { kind: 'error', message: errMsg };
    }
    testBtn.disabled = false;
  });

  // Botón Eliminar: solo visible si el provider activo tiene api_key.
  // Confirm inline: primer click cambia el botón a '¿Seguro?' + 2
  // botones Sí/No. Segundo click en Sí confirma. Click fuera del
  // área cancela (no lo implementamos por simplicidad; el user puede
  // hacer click en Sí o No, o esperar al próximo render).
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'settings-btn settings-btn--danger';
  deleteBtn.textContent = 'Eliminar';
  deleteBtn.style.display = 'none';
  let confirmingDelete = false;
  let confirmTimer: number | null = null;

  const cancelDelete = (): void => {
    confirmingDelete = false;
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.classList.remove('settings-btn--confirming');
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  };

  deleteBtn.addEventListener('click', async () => {
    if (!confirmingDelete) {
      // Primer click: pedir confirmación.
      confirmingDelete = true;
      deleteBtn.textContent = '¿Seguro? Sí';
      deleteBtn.classList.add('settings-btn--confirming');
      // Auto-cancelar después de 5s.
      confirmTimer = window.setTimeout(cancelDelete, 5000);
      return;
    }
    // Segundo click: confirmar eliminación.
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    deleteBtn.disabled = true;
    saveStatus.value = { kind: 'idle' };
    try {
      await deleteApiKey(currentProvider);
      saveStatus.value = { kind: 'saved' };
      // Refrescar estado + lista de modelos.
      await loadAuthStatus();
      await loadModels();
      // Limpiar el input (la key recién eliminada puede estar visible).
      keyInput.value = '';
      keyInput.type = 'password';
      if (isKeyVisible) {
        eyeBtn.textContent = '👁';
        eyeBtn.setAttribute('aria-label', 'Mostrar API key');
        isKeyVisible = false;
      }
    } catch (err) {
      saveStatus.value = {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      deleteBtn.disabled = false;
      cancelDelete();
    }
  });

  actions.append(saveBtn, testBtn, deleteBtn);
  control.append(actions);

  // Feedback: ✓ Guardado, ✓ Funciona, ✗ <error>. Se actualiza via
  // suscripción a saveStatus, así el repaint es local (no toca los
  // inputs ni los tabs).
  const feedback = document.createElement('div');
  feedback.className = 'settings-provider-feedback';
  saveStatus.subscribe((status) => {
    feedback.className = 'settings-provider-feedback';
    if (status.kind === 'idle') {
      feedback.textContent = '';
    } else if (status.kind === 'saved') {
      feedback.classList.add('settings-provider-feedback--ok');
      feedback.textContent = '✓ Guardado';
    } else if (status.kind === 'tested') {
      feedback.classList.add('settings-provider-feedback--ok');
      feedback.textContent = '✓ Funciona';
    } else {
      feedback.classList.add('settings-provider-feedback--err');
      feedback.textContent = `✗ ${status.message}`;
    }
  });
  control.append(feedback);

  // Llamada inicial + suscripción. Se hacen ACÁ (no antes) porque
  // `keyInput`, `eyeBtn` y `deleteBtn` se declaran en este bloque
  // y `updateProviderUI` los referencia. Si se llamara antes, TDZ.
  updateProviderUI(appState.configuredProviders.value);
  scope.add(appState.configuredProviders.subscribe(updateProviderUI));

  return createSection({
    title: 'Proveedor',
    description: 'Tu modelo de lenguaje. Pega la API key del provider que quieras usar.',
    control,
  });
}

function renderModelSection(scope: Scope): HTMLElement {
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
  scope.add(modelsLoading.subscribe(repaint));
  scope.add(modelsError.subscribe(repaint));
  scope.add(appState.availableModels.subscribe(() => repaint()));
  scope.add(appState.currentModel.subscribe(() => repaint()));

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

function renderSessionSection(scope: Scope): HTMLElement {
  const sessionValue = document.createElement('span');
  sessionValue.className = 'settings-value';
  sessionValue.textContent = 'ninguna';

  const paint = (session: { id: string } | null): void => {
    sessionValue.textContent = session ? session.id.slice(0, 8) + '…' : 'ninguna';
  };
  paint(appState.session.value);
  scope.add(appState.session.subscribe(paint));

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

/** Versión de xi. Debe coincidir con backend/Cargo.toml. */
const APP_VERSION = '0.1.5';

function renderAboutSection(scope: Scope): HTMLElement {
  // El row muestra "xi v0.1.0 — pi v0.79.3" (o "pi desconocida" si
  // el sidecar no responde). Una sola línea, em-dash como separador.
  // El user final ve esto en Acerca de; es toda la info que necesita.
  const versionValue = document.createElement('span');
  versionValue.className = 'settings-value';

  const paint = (): void => {
    const pi = appState.piVersion.value;
    const piText = pi === 'unknown' ? 'desconocida' : `v${pi}`;
    versionValue.textContent = `xi v${APP_VERSION} — pi ${piText}`;
  };

  paint();
  scope.add(appState.piVersion.subscribe(paint));

  const row = document.createElement('div');
  row.className = 'settings-row';
  row.append(label('Versión'));
  row.append(versionValue);

  return createSection({
    title: 'Acerca de',
    description: 'Información de la aplicación.',
    control: row,
  });
}

// ═══════════════════════════════════════════════════════
// Sección de update (Etapa 7)
// ═══════════════════════════════════════════════════════

function renderUpdateSection(scope: Scope): HTMLElement {
  // En dev mode, el updater no funciona (no hay releases publicados).
  // Mostramos un mensaje claro en vez del error de red.
  if (!isUpdaterAvailable()) {
    return createSection({
      title: 'Actualización',
      description: 'No disponible en modo desarrollo. Solo funciona en la versión instalada.',
      control: value('Ejecutá una build de release para probar el updater.'),
    });
  }

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
  scope.add(appState.updateStatus.subscribe(repaint));
  scope.add(appState.updateReady.subscribe(repaint));
  scope.add(appState.updateError.subscribe(repaint));
  scope.add(appState.updateDismissed.subscribe(repaint));

  return createSection({
    title: 'Actualización',
    description: 'Versiones nuevas de xi. La app puede actualizarse sola en background.',
    control: row,
  });
}

/** Helper de exhaustividad: si llegamos acá, el compilador nos
 *  está diciendo que `status` tiene un valor que no cubrimos en
 *  el switch. Mejor explotar con un mensaje claro que devolver
 *  undefined silencioso. */
function assertNever(value: never): never {
  throw new Error(`Undesigned state: ${String(value)}`);
}

/** Texto que ve el user en la columna "Actualización". Resume el
 *  estado de updateStatus en lenguaje natural. */
function statusText(): string {
  const status = appState.updateStatus.value;
  switch (status) {
    case 'idle':         return 'Al día';
    case 'checking':     return 'Buscando...';
    case 'downloading':  return `Descargando v${appState.updateReady.value?.version ?? ''}...`;
    case 'ready':        return `v${appState.updateReady.value?.version ?? ''} lista para aplicar`;
    case 'error':        return `Error: ${appState.updateError.value ?? 'desconocido'}`;
    default:             return assertNever(status);
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
async function loadModels(): Promise<void> {
  modelsLoading.value = true;
  modelsError.value = null;

  // Asegurar que pi esté corriendo antes de pedirle modelos.
  // Sin esto, si pi terminó después de restaurar una sesión,
  // getAvailableModels falla con "pi process not running".
  await ensurePiRunning();
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
    btn.dataset.value = opt.value;
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

// ═══════════════════════════════════════════════════════
// Sección de Extensiones
// ═══════════════════════════════════════════════════════

function renderExtensionsSection(scope: Scope): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'settings-extensions-controls';

  // ── pi-exa ──
  controls.append(renderExaConfig());

  // ── pi-approve ──
  controls.append(renderApproveConfig());

  return createSection({
    title: 'Extensiones',
    description: 'Configuración de las extensiones que vienen con xi.',
    control: controls,
  });
}

// ────────────── pi-exa ────────────────────────────────────

function renderExaConfig(): HTMLElement {
  const block = document.createElement('div');
  block.className = 'settings-extension-block';

  const title = document.createElement('h3');
  title.className = 'settings-subsection-title';
  title.textContent = 'pi-exa — Búsqueda web';
  block.append(title);

  const desc = document.createElement('p');
  desc.className = 'settings-subsection-desc';
  desc.textContent = 'API key de Exa para buscar en internet desde pi.';
  block.append(desc);

  // Estado local
  const saveStatus = signal<
    | { kind: 'idle' }
    | { kind: 'saved' }
    | { kind: 'tested' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Status de la key (viene del backend)
  const statusText = document.createElement('div');
  statusText.className = 'settings-exa-status';

  // Input + eye
  const keyRow = document.createElement('div');
  keyRow.className = 'settings-provider-keyrow';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'settings-input settings-provider-keyinput';
  keyInput.placeholder = 'sk-...';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;

  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'settings-provider-toggle';
  eyeBtn.setAttribute('aria-label', 'Mostrar/Ocultar API key de Exa');
  eyeBtn.textContent = '👁';
  eyeBtn.style.display = 'none';
  let isKeyVisible = false;

  eyeBtn.addEventListener('click', async () => {
    if (isKeyVisible) {
      keyInput.value = '';
      keyInput.type = 'password';
      eyeBtn.textContent = '👁';
      isKeyVisible = false;
      return;
    }
    if (keyInput.value === '') {
      eyeBtn.disabled = true;
      const key = await getExaApiKey();
      eyeBtn.disabled = false;
      if (key === null) {
        saveStatus.value = { kind: 'error', message: 'No se pudo leer la key' };
        return;
      }
      keyInput.value = key;
    }
    keyInput.type = 'text';
    eyeBtn.textContent = '🙈';
    isKeyVisible = true;
  });

  keyRow.append(keyInput, eyeBtn);
  block.append(keyRow);

  // Botones
  const actions = document.createElement('div');
  actions.className = 'settings-provider-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'settings-btn settings-btn--primary';
  saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      saveStatus.value = { kind: 'error', message: 'Pegá una key antes de guardar' };
      return;
    }
    saveBtn.disabled = true;
    saveStatus.value = { kind: 'idle' };
    try {
      await setExaApiKey(key);
      saveStatus.value = { kind: 'saved' };
      if (isKeyVisible) {
        keyInput.value = '';
        keyInput.type = 'password';
        eyeBtn.textContent = '👁';
        isKeyVisible = false;
      }
      loadExaStatus(statusText, eyeBtn, keyInput, deleteBtn);
    } catch (err) {
      saveStatus.value = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    } finally {
      saveBtn.disabled = false;
    }
  });

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'settings-btn';
  testBtn.textContent = 'Probar';
  testBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      saveStatus.value = { kind: 'error', message: 'Pegá una key antes de probar' };
      return;
    }
    testBtn.disabled = true;
    saveStatus.value = { kind: 'idle' };
    const errMsg = await testExaApiKey(key);
    if (errMsg === '') {
      saveStatus.value = { kind: 'tested' };
    } else {
      saveStatus.value = { kind: 'error', message: errMsg };
    }
    testBtn.disabled = false;
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'settings-btn settings-btn--danger';
  deleteBtn.textContent = 'Eliminar';
  deleteBtn.style.display = 'none';

  let confirmingDelete = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelDelete = (): void => {
    confirmingDelete = false;
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.classList.remove('settings-btn--confirming');
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  };

  deleteBtn.addEventListener('click', async () => {
    if (!confirmingDelete) {
      confirmingDelete = true;
      deleteBtn.textContent = '¿Seguro?';
      deleteBtn.classList.add('settings-btn--confirming');
      confirmTimer = setTimeout(cancelDelete, 5000);
      return;
    }
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    deleteBtn.disabled = true;
    saveStatus.value = { kind: 'idle' };
    try {
      await deleteExaApiKey();
      saveStatus.value = { kind: 'saved' };
      keyInput.value = '';
      keyInput.type = 'password';
      eyeBtn.textContent = '👁';
      isKeyVisible = false;
      loadExaStatus(statusText, eyeBtn, keyInput, deleteBtn);
    } catch (err) {
      saveStatus.value = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    } finally {
      deleteBtn.disabled = false;
      cancelDelete();
    }
  });

  actions.append(saveBtn, testBtn, deleteBtn);
  block.append(actions);

  // Feedback
  const feedback = document.createElement('div');
  feedback.className = 'settings-provider-feedback';
  saveStatus.subscribe((status) => {
    feedback.className = 'settings-provider-feedback';
    if (status.kind === 'idle') {
      feedback.textContent = '';
    } else if (status.kind === 'saved') {
      feedback.classList.add('settings-provider-feedback--ok');
      feedback.textContent = '✓ Guardado';
    } else if (status.kind === 'tested') {
      feedback.classList.add('settings-provider-feedback--ok');
      feedback.textContent = '✓ Funciona';
    } else {
      feedback.classList.add('settings-provider-feedback--err');
      feedback.textContent = `✗ ${status.message}`;
    }
  });
  block.append(feedback);

  // Cargar estado inicial
  loadExaStatus(statusText, eyeBtn, keyInput, deleteBtn);

  return block;
}

/** Carga el estado de la key de Exa desde el backend y actualiza la UI. */
async function loadExaStatus(
  statusText: HTMLElement,
  eyeBtn: HTMLElement,
  keyInput: HTMLInputElement,
  deleteBtn: HTMLElement,
): Promise<void> {
  try {
    const config = await getExaConfig();
    if (config.hasKey && config.last4) {
      statusText.textContent = `Configurada (···${config.last4})`;
      statusText.className = 'settings-exa-status settings-exa-status--configured';
      eyeBtn.style.display = 'inline-block';
      keyInput.placeholder = `Actual: sk-***${config.last4} — pega una nueva para cambiar`;
    } else {
      statusText.textContent = 'No configurada';
      statusText.className = 'settings-exa-status';
      eyeBtn.style.display = 'none';
      keyInput.placeholder = 'sk-...';
    }
    deleteBtn.style.display = config.hasKey ? 'inline-block' : 'none';
  } catch {
    statusText.textContent = 'Error al cargar';
    statusText.className = 'settings-exa-status';
  }
}

// ────────────── pi-approve ────────────────────────────────

const APPROVE_TOOLS = [
  { key: 'bash', label: 'Bash', desc: 'Comandos que requieren confirmación' },
  { key: 'write', label: 'Write', desc: 'Archivos donde escribir requiere confirmación' },
  { key: 'edit', label: 'Edit', desc: 'Archivos donde editar requiere confirmación' },
] as const;

function renderApproveConfig(): HTMLElement {
  const block = document.createElement('div');
  block.className = 'settings-extension-block';

  const title = document.createElement('h3');
  title.className = 'settings-subsection-title';
  title.textContent = 'pi-approve — Aprobación de comandos';
  block.append(title);

  const desc = document.createElement('p');
  desc.className = 'settings-subsection-desc';
  desc.textContent = 'Patrones que requieren confirmación antes de ejecutarse.';
  block.append(desc);

  // Estado: reglas cargadas del backend
  const rules = signal<ApproveRules | null>(null);
  const saveStatus = signal<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });

  // Tool cards
  const toolsContainer = document.createElement('div');
  toolsContainer.className = 'settings-approve-tools';

  // Inputs refs para recolección al guardar
  const toolInputs: Record<string, { patterns: HTMLInputElement; msg: HTMLInputElement }> = {};

  for (const tool of APPROVE_TOOLS) {
    const card = document.createElement('div');
    card.className = 'settings-approve-tool';

    const toolTitle = document.createElement('h4');
    toolTitle.className = 'settings-approve-tool-title';
    toolTitle.textContent = tool.label;
    card.append(toolTitle);

    const toolDesc = document.createElement('p');
    toolDesc.className = 'settings-approve-tool-desc';
    toolDesc.textContent = tool.desc;
    card.append(toolDesc);

    // Tags container (se llena cuando se cargan las reglas)
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'settings-approve-tags';
    card.append(tagsContainer);

    // Add pattern row
    const addRow = document.createElement('div');
    addRow.className = 'settings-approve-addrow';

    const patternInput = document.createElement('input');
    patternInput.type = 'text';
    patternInput.className = 'settings-input settings-approve-input';
    patternInput.placeholder = 'Ej: rm -rf';
    patternInput.spellcheck = false;
    addRow.append(patternInput);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'settings-btn settings-btn--small';
    addBtn.textContent = '+ Agregar';
    addBtn.addEventListener('click', () => {
      const val = patternInput.value.trim();
      if (!val) return;
      addTagToContainer(tagsContainer, val, patternInput, tool.key);
      patternInput.value = '';
    });
    patternInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addBtn.click();
      }
    });
    addRow.append(addBtn);
    card.append(addRow);

    // Message input
    const msgRow = document.createElement('div');
    msgRow.className = 'settings-approve-msgrow';

    const msgLabel = document.createElement('span');
    msgLabel.className = 'settings-approve-msglabel';
    msgLabel.textContent = 'Mensaje:';
    msgRow.append(msgLabel);

    const msgInput = document.createElement('input');
    msgInput.type = 'text';
    msgInput.className = 'settings-input settings-approve-msginput';
    msgInput.placeholder = 'Confirm before running...';
    msgInput.spellcheck = false;
    msgRow.append(msgInput);
    card.append(msgRow);

    toolInputs[tool.key] = { patterns: patternInput, msg: msgInput };
    toolsContainer.append(card);
  }

  block.append(toolsContainer);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'settings-provider-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'settings-btn settings-btn--primary';
  saveBtn.textContent = 'Guardar reglas';
  saveBtn.addEventListener('click', async () => {
    // Recolectar patrones de los tags visibles
    const config: ApproveRules = { rules: {}, messages: {} };
    for (const tool of APPROVE_TOOLS) {
      const allTags = toolsContainer.querySelectorAll('.settings-approve-tag');
      const patterns: string[] = [];
      for (const tag of allTags) {
        if ((tag as HTMLElement).dataset.tool === tool.key) {
          const text = (tag as HTMLElement).dataset.pattern;
          if (text) patterns.push(text);
        }
      }
      config.rules[tool.key] = patterns;
      config.messages[tool.key] = toolInputs[tool.key].msg.value.trim() || `Confirm before using ${tool.label.toLowerCase()}`;
    }

    saveBtn.disabled = true;
    saveStatus.value = { kind: 'idle' };
    try {
      await setApproveRules(config);
      saveStatus.value = { kind: 'saved' };
    } catch (err) {
      saveStatus.value = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    } finally {
      saveBtn.disabled = false;
    }
  });

  actions.append(saveBtn);
  block.append(actions);

  // Feedback
  const feedback = document.createElement('div');
  feedback.className = 'settings-provider-feedback';
  saveStatus.subscribe((status) => {
    feedback.className = 'settings-provider-feedback';
    if (status.kind === 'idle') {
      feedback.textContent = '';
    } else if (status.kind === 'saved') {
      feedback.classList.add('settings-provider-feedback--ok');
      feedback.textContent = '✓ Guardado';
    } else {
      feedback.classList.add('settings-provider-feedback--err');
      feedback.textContent = `✗ ${status.message}`;
    }
  });
  block.append(feedback);

  // Cargar reglas actuales y popular la UI
  getApproveRules()
    .then((loaded) => {
      for (const tool of APPROVE_TOOLS) {
        const toolCard = toolsContainer.children[APPROVE_TOOLS.indexOf(tool)] as HTMLElement;
        if (!toolCard) continue;
        const tagsContainer = toolCard.querySelector('.settings-approve-tags') as HTMLElement;
        if (!tagsContainer) continue;

        const patterns = loaded.rules[tool.key] ?? [];
        for (const pattern of patterns) {
          addTagToContainer(tagsContainer, pattern, null, tool.key);
        }

        const msg = loaded.messages[tool.key] ?? '';
        toolInputs[tool.key].msg.value = msg;
      }
    })
    .catch((err) => {
      saveStatus.value = { kind: 'error', message: 'Error al cargar reglas: ' + (err instanceof Error ? err.message : String(err)) };
    });

  return block;
}

/** Agrega un tag al container visual. Si inputRef no es null, limpia el input. */
function addTagToContainer(
  container: HTMLElement,
  pattern: string,
  inputRef: HTMLInputElement | null,
  toolKey?: string,
): void {
  // Evitar duplicados
  const existing = container.querySelectorAll('.settings-approve-tag');
  for (const tag of existing) {
    if ((tag as HTMLElement).dataset.pattern === pattern) return;
  }

  const tag = document.createElement('span');
  tag.className = 'settings-approve-tag';
  tag.dataset.pattern = pattern;
  if (toolKey) tag.dataset.tool = toolKey;
  tag.textContent = pattern;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'settings-approve-tag-remove';
  removeBtn.textContent = '×';
  removeBtn.setAttribute('aria-label', `Quitar ${pattern}`);
  removeBtn.addEventListener('click', () => {
    tag.remove();
  });

  tag.append(removeBtn);
  container.append(tag);
}
