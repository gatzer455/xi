/**
 * SettingsPage.tsx — Configuración (SolidJS).
 */
import { createSignal, createMemo, For, Show, onCleanup, onMount } from 'solid-js';
import { appState, type ThemeMode, type FontSize, type ThinkingLevel } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import {
  setModel, setThinkingLevel, getAvailableModels, getPiVersion, getPiState,
  getApiKey, setApiKey, testApiKey, deleteApiKey, type ProviderInfo,
  getExaConfig, getExaApiKey, setExaApiKey, deleteExaApiKey, testExaApiKey,
  getApproveRules, setApproveRules, type ApproveRules,
} from 'xi-ui/lib/pi/tauri-commands.ts';
import { ensurePiRunning } from '../lib/pi/index.ts';
import { loadAuthStatus } from '../lib/auth-status.ts';
import { applyThemeToDOM, applyFontToDOM, saveTheme, saveFontSize } from '../lib/settings-storage.ts';
import { checkForUpdate, installAndRelaunch, isUpdaterAvailable } from '../lib/updater.ts';

type SettingsTab = 'provider' | 'appearance' | 'extensions' | 'about';

const PROVIDERS = [
  { id: 'opencode-go', label: 'OpenCode Go' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'google', label: 'Google' },
  { id: 'groq', label: 'Groq' },
  { id: 'openai', label: 'OpenAI' },
] as const;

type PId = (typeof PROVIDERS)[number]['id'];

const APPROVE_TOOLS = [
  { key: 'bash', label: 'Bash', desc: 'Comandos que requieren confirmación' },
  { key: 'write', label: 'Write', desc: 'Archivos donde escribir requiere confirmación' },
  { key: 'edit', label: 'Edit', desc: 'Archivos donde editar requiere confirmación' },
] as const;

/* ─── Helpers ─── */

function lastProvider(): PId {
  const s = localStorage.getItem('xi.lastProvider');
  if (s && PROVIDERS.some((p) => p.id === s)) return s as PId;
  return 'opencode-go';
}

function Segmented<T extends string>(props: { options: readonly { value: T; label: string }[]; current: T; onChange: (v: T) => void }) {
  return (
    <div class="settings-segmented" role="group">
      <For each={props.options}>{(opt) => (
        <button type="button" classList={{ 'settings-segmented-btn': true, 'settings-segmented-btn--active': opt.value === props.current }}
                aria-pressed={opt.value === props.current ? 'true' : 'false'}
                data-value={opt.value} onClick={() => props.onChange(opt.value)}>{opt.label}</button>
      )}</For>
    </div>
  );
}

function Section(props: { title: string; desc: string; children: any }) {
  return (
    <section class="settings-section">
      <h2 class="settings-section-title">{props.title}</h2>
      <p class="settings-section-desc">{props.desc}</p>
      <div class="settings-control">{props.children}</div>
    </section>
  );
}

/* ─── Eye input (password toggle) ─── */

function EyeInput(props: { placeholder: string; onSave: (key: string) => Promise<void>; onTest: (key: string) => Promise<string>; onReveal?: () => Promise<string | null> }) {
  const [visible, setVisible] = createSignal(false);
  const [value, setValue] = createSignal('');
  const [status, setStatus] = createSignal<{ kind: 'idle' } | { kind: 'ok'; msg: string } | { kind: 'error'; msg: string }>({ kind: 'idle' });

  let inputRef: HTMLInputElement | undefined;

  async function toggleVisibility() {
    if (visible()) { setVisible(false); return; }
    if (value() === '' && props.onReveal) {
      try {
        const key = await props.onReveal();
        if (key) { setValue(key); setVisible(true); return; }
      } catch { /* no disponible */ }
    }
    if (value() !== '') setVisible(true);
  }

  async function test() {
    const v = value().trim();
    if (!v) { setStatus({ kind: 'error', msg: 'Pegá una key antes de probar' }); return; }
    const err = await props.onTest(v);
    setStatus(err ? { kind: 'error', msg: err } : { kind: 'ok', msg: '✓ Funciona' });
  }

  async function save() {
    const v = value().trim();
    if (!v) { setStatus({ kind: 'error', msg: 'Pegá una key antes de guardar' }); return; }
    await props.onSave(v);
    setStatus({ kind: 'ok', msg: '✓ Guardado' });
    if (visible()) { setValue(''); setVisible(false); }
  }

  return (
    <div>
      <div class="settings-provider-keyrow">
        <input ref={inputRef} type={visible() ? 'text' : 'password'} class="settings-input settings-provider-keyinput"
               placeholder={props.placeholder} autocomplete="off" spellcheck={false}
               value={value()} onInput={(e) => setValue(e.currentTarget.value)} />
        <button type="button" class="settings-provider-toggle" aria-label="Mostrar/Ocultar key"
                onClick={toggleVisibility}>{visible() ? '🙈' : '👁'}</button>
      </div>
      <div class="settings-provider-actions">
        <button type="button" class="settings-btn settings-btn--primary" onClick={save}>Guardar</button>
        <button type="button" class="settings-btn" onClick={test}>Probar</button>
      </div>
      <Show when={status().kind !== 'idle'}>{(st) => {
        const s = status();
        return <div classList={{ 'settings-provider-feedback': true, 'settings-provider-feedback--ok': s.kind === 'ok', 'settings-provider-feedback--err': s.kind === 'error' }}>
          {s.kind === 'ok' ? '✓ ' + s.msg : '✗ ' + (s as any).msg}
        </div>;
      }}</Show>
    </div>
  );
}

/* ─── Main page ─── */

export function SettingsPage() {
  const [tab, setTab] = createSignal<SettingsTab>('provider');

  // Cargar modelos y version al mount
  onMount(() => {
    if (appState.workingDir.value && appState.availableModels.value.length === 0) { getAvailableModels(); }
    getPiVersion().then((v) => appState.piVersion.value = v);
    loadAuthStatus();
    if (appState.workingDir.value) { ensurePiRunning().then(() => getPiState()).catch(() => {}); }
  });

  return (
    <div class="settings-page">
      <button class="settings-back" onClick={() => navigate(appState.previousView.value)}>← Volver</button>
      <h1 class="settings-title">Configuración</h1>

      <div class="settings-tabs">
        <div class="settings-tab-bar">
          <For each={[{ id: 'provider' as const, label: 'Proveedor' }, { id: 'appearance' as const, label: 'Apariencia' }, { id: 'extensions' as const, label: 'Extensiones' }, { id: 'about' as const, label: 'Acerca de' }]}>
            {(t) => <button type="button" classList={{ 'settings-tab-btn': true, 'settings-tab-btn--active': tab() === t.id }} onClick={() => setTab(t.id)}>{t.label}</button>}
          </For>
        </div>

        <div class="settings-tab-content">
          <Show when={tab() === 'provider'}><ProviderSection /></Show>
          <Show when={tab() === 'appearance'}><AppearanceSection /></Show>
          <Show when={tab() === 'extensions'}><ExtensionsSection /></Show>
          <Show when={tab() === 'about'}><><UpdateSection /><SessionSection /><AboutSection /></></Show>
        </div>
      </div>
    </div>
  );
}

/* ─── Provider ─── */

function ProviderSection() {
  const [current, setCurrent] = createSignal<PId>(lastProvider());
  const [configured, setConfigured] = createSignal<ReadonlyArray<ProviderInfo>>(appState.configuredProviders.value);

  onCleanup(appState.configuredProviders.subscribe(setConfigured));

  const activeProvider = createMemo(() => configured().find((p) => p.id === current()));

  function switchProvider(id: PId) {
    setCurrent(id);
    localStorage.setItem('xi.lastProvider', id);
  }

  function providerLabel(id: PId): string {
    const p = configured().find((c) => c.id === id);
    return p ? `${PROVIDERS.find((x) => x.id === id)!.label} ✓` : PROVIDERS.find((x) => x.id === id)!.label;
  }

  async function saveKey(key: string) {
    await setApiKey(current(), key);
    await loadAuthStatus();
    getAvailableModels();
  }

  const placeholder = createMemo(() => {
    const p = activeProvider();
    if (p?.hasKey && p.last4) return `Actual: sk-***${p.last4} — pega una nueva para cambiar`;
    if (p && !p.hasKey) return 'OAuth — no editable';
    return 'sk-...';
  });

  const statusText = createMemo(() => {
    const c = configured();
    if (c.length === 0) return 'No hay providers configurados todavía.';
    const editable = c.filter((p) => p.hasKey).length;
    const total = c.length;
    if (editable === total) return `Tienes ${total} provider${total > 1 ? 's' : ''} configurado${total > 1 ? 's' : ''}. Marcados con ✓ abajo.`;
    return `Tienes ${total} provider${total > 1 ? 's' : ''} configurado${total > 1 ? 's' : ''} (${editable} con API key). Marcados con ✓ abajo.`;
  });

  return (
    <div class="settings-provider-control">
      <div class="settings-segmented" role="group">
        <For each={PROVIDERS}>{(p) => (
          <button type="button" classList={{ 'settings-segmented-btn': true, 'settings-segmented-btn--active': current() === p.id, 'settings-segmented-btn--configured': configured().some((c) => c.id === p.id) }}
                  onClick={() => switchProvider(p.id)}>{providerLabel(p.id)}</button>
        )}</For>
      </div>

      <div class="settings-provider-status">{statusText()}</div>

      <Show when={activeProvider() && !activeProvider()!.hasKey}>
        <div class="settings-provider-keyhint">Este provider está configurado con OAuth (no editable desde xi). Usa `pi login` en una terminal para cambiarlo.</div>
      </Show>

      <EyeInput placeholder={placeholder()} onSave={saveKey} onTest={(key) => testApiKey(current(), key)}
               onReveal={() => getApiKey(current())} />

      <Show when={activeProvider()?.hasKey}>
        <DeleteButton onDelete={async () => {
          await deleteApiKey(current());
          await loadAuthStatus();
          getAvailableModels();
        }} />
      </Show>
    </div>
  );
}

function DeleteButton(props: { onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() { setConfirming(false); clearTimeout(timer); }

  return (
    <div class="settings-provider-actions" style="margin-top: 8px">
      <Show when={!confirming()}
            fallback={
              <button type="button" class="settings-btn settings-btn--danger settings-btn--confirming"
                      onClick={() => { cancel(); void props.onDelete(); }}>¿Seguro? Sí</button>
            }>
        <button type="button" class="settings-btn settings-btn--danger"
                onClick={() => { setConfirming(true); timer = setTimeout(cancel, 5000); }}>Eliminar</button>
      </Show>
      <Show when={confirming()}><button type="button" class="settings-btn" onClick={cancel}>No</button></Show>
    </div>
  );
}

/* ─── Appearance ─── */

function AppearanceSection() {
  const [theme, setTheme] = createSignal(appState.theme.value);
  const [fontSize, setFontSize] = createSignal(appState.fontSize.value);

  onCleanup(appState.theme.subscribe(setTheme));
  onCleanup(appState.fontSize.subscribe(setFontSize));

  return (
    <div class="settings-appearance-controls">
      <div class="settings-sublabel">Tema</div>
      <Segmented options={[{ value: 'dark' as const, label: 'Oscuro' }, { value: 'light' as const, label: 'Claro' }, { value: 'system' as const, label: 'Sistema' }]}
                 current={theme()} onChange={(t) => { appState.theme.value = t; applyThemeToDOM(t); saveTheme(t); }} />
      <div class="settings-sublabel">Fuente</div>
      <Segmented options={[{ value: 'small' as const, label: 'Pequeña' }, { value: 'medium' as const, label: 'Mediana' }, { value: 'large' as const, label: 'Grande' }]}
                 current={fontSize()} onChange={(s) => { appState.fontSize.value = s; applyFontToDOM(s); saveFontSize(s); }} />
    </div>
  );
}

/* ─── Update ─── */

function UpdateSection() {
  const [status, setStatus] = createSignal(appState.updateStatus.value);
  const [ready, setReady] = createSignal(appState.updateReady.value);
  const [error, setError] = createSignal(appState.updateError.value);
  const [dismissed, setDismissed] = createSignal(appState.updateDismissed.value);

  onCleanup(appState.updateStatus.subscribe(setStatus));
  onCleanup(appState.updateReady.subscribe(setReady));
  onCleanup(appState.updateError.subscribe(setError));
  onCleanup(appState.updateDismissed.subscribe(setDismissed));

  const statusText = createMemo(() => {
    const s = status();
    switch (s) {
      case 'idle': return 'Al día';
      case 'checking': return 'Buscando...';
      case 'downloading': return `Descargando v${ready()?.version ?? ''}...`;
      case 'ready': return `v${ready()?.version ?? ''} lista para aplicar`;
      case 'error': return `Error: ${error() ?? 'desconocido'}`;
      default: return '';
    }
  });

  if (!isUpdaterAvailable()) return null;

  return (
    <Section title="Actualización" desc="Versiones nuevas de xi. La app puede actualizarse sola en background.">
      <div class="settings-row settings-update-row">
        <span class="settings-label">Actualización</span>
        <span classList={{ 'settings-value': true, 'settings-update-status': true, [`settings-update-status--${status()}`]: true }}>{statusText()}</span>
        <div class="settings-update-actions">
          <button class="settings-button" disabled={status() === 'checking' || status() === 'downloading'}
                  onClick={() => void checkForUpdate()}>{status() === 'checking' || status() === 'downloading' ? 'Buscando...' : 'Buscar actualización'}</button>
          <Show when={status() === 'ready' && !dismissed()}>
            <button class="settings-button settings-button--primary" onClick={() => void installAndRelaunch()}>Reiniciar para aplicar</button>
          </Show>
        </div>
      </div>
    </Section>
  );
}

/* ─── Session ─── */

function SessionSection() {
  const [session, setSession] = createSignal(appState.session.value);
  onCleanup(appState.session.subscribe(setSession));

  return (
    <Section title="Sesión" desc="Identificador de la conversación activa.">
      <div class="settings-row">
        <span class="settings-label">Sesión actual</span>
        <span class="settings-value">{session() ? session()!.id.slice(0, 8) + '…' : 'ninguna'}</span>
      </div>
    </Section>
  );
}

/* ─── About ─── */

function AboutSection() {
  const [piVer, setPiVer] = createSignal(appState.piVersion.value);
  onCleanup(appState.piVersion.subscribe(setPiVer));

  return (
    <Section title="Acerca de" desc="Información de la aplicación.">
      <div class="settings-row">
        <span class="settings-label">Versión</span>
        <span class="settings-value">xi v{__APP_VERSION__} — pi {piVer() === 'unknown' ? 'desconocida' : `v${piVer()}`}</span>
      </div>
    </Section>
  );
}

/* ─── Extensions ─── */

function ExtensionsSection() {
  return (
    <div class="settings-extensions-controls">
      <ExaSection />
      <ApproveSection />
    </div>
  );
}

function ExaSection() {
  const [configured, setConfigured] = createSignal<{ hasKey: boolean; last4?: string }>({ hasKey: false });
  const [status, setStatus] = createSignal<{ kind: 'idle' } | { kind: 'ok'; msg: string } | { kind: 'error'; msg: string }>({ kind: 'idle' });

  onMount(async () => {
    try {
      setConfigured(await getExaConfig().then((c) => ({ hasKey: c.hasKey, last4: c.last4 ?? undefined })));
    } catch { /* ignore */ }
  });

  async function saveKey(key: string) {
    await setExaApiKey(key);
    setStatus({ kind: 'ok', msg: '✓ Guardado' });
    try { setConfigured(await getExaConfig().then((c) => ({ hasKey: c.hasKey, last4: c.last4 ?? undefined }))); } catch { /* ignore */ }
  }

  const placeholder = () => configured().hasKey && configured().last4 ? `Actual: sk-***${configured().last4} — pega una nueva para cambiar` : 'sk-...';

  return (
    <div class="settings-extension-block">
      <h3 class="settings-subsection-title">xi-exa — Búsqueda web</h3>
      <p class="settings-subsection-desc">API key de Exa para buscar en internet desde pi.</p>
      <div classList={{ 'settings-exa-status': true, 'settings-exa-status--configured': configured().hasKey }}>
        {configured().hasKey ? `Configurada (···${configured().last4})` : 'No configurada'}
      </div>
      <EyeInput placeholder={placeholder()} onSave={saveKey} onTest={async (key) => { const err = await testExaApiKey(key); return err ? err : ''; }}
               onReveal={() => getExaApiKey()} />
    </div>
  );
}

function ApproveSection() {
  const [rules, setRules] = createSignal<ApproveRules | null>(null);
  const [saved, setSaved] = createSignal(false);
  const [bashPatterns, setBashPatterns] = createSignal<string[]>([]);
  const [writePatterns, setWritePatterns] = createSignal<string[]>([]);
  const [editPatterns, setEditPatterns] = createSignal<string[]>([]);

  onMount(async () => {
    try {
      const r = await getApproveRules();
      setRules(r);
      setBashPatterns(r.rules.bash ?? []);
      setWritePatterns(r.rules.write ?? []);
      setEditPatterns(r.rules.edit ?? []);
    } catch { /* ignore */ }
  });

  async function save() {
    const newRules: ApproveRules = { rules: { bash: bashPatterns(), write: writePatterns(), edit: editPatterns() }, messages: {} };
    try { await setApproveRules(newRules); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch { /* ignore */ }
  }

  const toolCards = [
    { key: 'bash', label: 'Bash', desc: 'Comandos que requieren confirmación', patterns: bashPatterns, setPatterns: setBashPatterns },
    { key: 'write', label: 'Write', desc: 'Archivos donde escribir requiere confirmación', patterns: writePatterns, setPatterns: setWritePatterns },
    { key: 'edit', label: 'Edit', desc: 'Archivos donde editar requiere confirmación', patterns: editPatterns, setPatterns: setEditPatterns },
  ];

  return (
    <div class="settings-extension-block">
      <h3 class="settings-subsection-title">xi-flow — Flujo de trabajo</h3>
      <p class="settings-subsection-desc">Patrones que requieren confirmación antes de ejecutarse.</p>
      <div class="settings-approve-tools">
        <For each={toolCards}>{(tool) => <ApproveToolCard tool={tool} />}</For>
      </div>
      <button type="button" class="settings-btn settings-btn--primary" onClick={save}>Guardar reglas</button>
      <Show when={saved()}><span style="margin-left: 8px; color: var(--color-success);">✓ Guardado</span></Show>
    </div>
  );
}

function ApproveToolCard(props: { tool: { key: string; label: string; desc: string; patterns: () => string[]; setPatterns: (v: string[]) => void } }) {
  const [input, setInput] = createSignal('');
  function add() {
    const v = input().trim();
    if (v && !props.tool.patterns().includes(v)) { props.tool.setPatterns([...props.tool.patterns(), v]); setInput(''); }
  }
  return (
    <div class="settings-approve-tool">
      <h4 class="settings-approve-tool-title">{props.tool.label}</h4>
      <p class="settings-approve-tool-desc">{props.tool.desc}</p>
      <div class="settings-approve-tags">
        <For each={props.tool.patterns()}>{(p) => (
          <span class="settings-approve-tag">
            {p}
            <button type="button" class="settings-approve-tag-remove" onClick={() => props.tool.setPatterns(props.tool.patterns().filter((x: string) => x !== p))}>✕</button>
          </span>
        )}</For>
      </div>
      <div class="settings-approve-addrow">
        <input type="text" class="settings-input settings-approve-input" placeholder="Ej: rm -rf" value={input()} onInput={(e) => setInput(e.currentTarget.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') add(); }} spellcheck={false} />
        <button type="button" class="settings-btn settings-btn--small" onClick={add}>+ Agregar</button>
      </div>
    </div>
  );
}
