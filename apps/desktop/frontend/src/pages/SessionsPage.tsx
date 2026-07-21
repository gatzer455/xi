/**
 * SessionsPage.tsx — Gestión de sesiones (SolidJS).
 */
import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { appState, type Session } from 'xi-ui/lib/state.ts';
import { setActiveTab } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { getStore } from 'xi-ui/lib/chat/stores.ts';
import { dropStore } from 'xi-ui/lib/chat/stores.ts';
import { icon } from 'xi-ui/lib/icons.ts';
import { ensurePiRunning } from '../lib/pi/lifecycle.ts';
import {
  listSessions, deleteSession, renameSession, startPi, stopPi,
  getPiMessages, newPiSession, getPiState, getAvailableModels,
} from '../lib/pi/index.ts';
import type { ListSessionsResult, SessionInfo, SkippedInfo } from 'xi-ui/lib/pi/types.ts';

const POLL_MS = 30_000;

export function SessionsPage() {
  const [sessions, setSessions] = createSignal<SessionInfo[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [skipped, setSkipped] = createSignal<SkippedInfo | null>(null);
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null);

  async function load() {
    if (loading() || renamingPath()) return;
    const cwd = appState.workingDir.value;
    if (!cwd) { setError('Selecciona una carpeta de trabajo primero'); return; }
    setLoading(true);
    try {
      const r: ListSessionsResult = await listSessions(cwd);
      setSessions((prev) => r.sessions.map((ns) => {
        const old = prev.find((p) => p.path === ns.path);
        return old && JSON.stringify(old) === JSON.stringify(ns) ? old : ns;
      }));
      setSkipped(r.skipped ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }

  onMount(() => { void load(); });

  const interval = setInterval(() => { void load(); }, POLL_MS);
  onCleanup(() => clearInterval(interval));

  const visHandler = () => { if (document.visibilityState === 'visible') void load(); };
  document.addEventListener('visibilitychange', visHandler);
  onCleanup(() => document.removeEventListener('visibilitychange', visHandler));

  async function createNew() {
    if (!appState.workingDir.value) { setError('Selecciona una carpeta de trabajo primero'); return; }
    const tabId = crypto.randomUUID();
    const now = new Date();
    const name = now.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const newTab: Session = { id: tabId, name, messageCount: 0 };
    setActiveTab(tabId);
    appState.openTabs.value = [...appState.openTabs.value, newTab];
    navigate('chat');
    try {
      const cwd = appState.workingDir.value;
      if (!cwd) return;
      await ensurePiRunning();
      await newPiSession();
      await getPiState();
      await getAvailableModels();
      const piSession = appState.session.value;
      if (piSession && !piSession.name && piSession.file) {
        try { await renameSession(piSession.file, name); piSession.name = name; } catch { /* best-effort */ }
      }
      if (piSession) {
        appState.openTabs.value = appState.openTabs.value.map((t) =>
          t.id === tabId ? { ...t, name: piSession.name || t.name, file: piSession.file, messageCount: piSession.messageCount } : t
        );
      }
      void load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function switchTo(session: SessionInfo) {
    const cwd = appState.workingDir.value;
    if (!cwd) return;
    const isOpen = appState.openTabs.value.some((t) => t.id === session.id);
    if (isOpen) { setActiveTab(session.id); navigate('chat'); return; }
    const newTab: Session = { id: session.id, name: session.name, file: session.path, messageCount: session.messageCount };
    setActiveTab(session.id);
    appState.openTabs.value = [...appState.openTabs.value, newTab];
    try {
      await startPi(cwd, session.path);
      await getPiState();
      await getPiMessages();
      await getAvailableModels();
      navigate('chat');
    } catch (err) {
      // Rollback: remover el tab que agregamos
      appState.activeTabId.value = appState.openTabs.value.length > 1
        ? appState.openTabs.value[appState.openTabs.value.length - 2].id
        : null;
      appState.openTabs.value = appState.openTabs.value.filter((t) => t.id !== session.id);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(session: SessionInfo) {
    if (!confirm('¿Borrar esta sesión?')) return;
    const isActive = session.path === appState.session.value?.file;
    if (isActive && !confirm('Esta es tu sesión activa. Se cerrará. ¿Continuar?')) return;
    try {
      await deleteSession(session.path);
      const tabsToRemove = appState.openTabs.value.filter((t) => t.file === session.path || t.id === session.id).map((t) => t.id);
      for (const tid of tabsToRemove) dropStore(tid);
      appState.openTabs.value = appState.openTabs.value.filter((t) => !tabsToRemove.includes(t.id));
      if (isActive) { await stopPi(); appState.activeTabId.value = null; appState.session.value = null; }
      setSessions((prev) => prev.filter((s) => s.path !== session.path));
      void load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function handleRename(session: SessionInfo, newName: string) {
    setSessions((prev) => prev.map((s) => s.path === session.path ? { ...s, name: newName } : s));
    setRenamingPath(null);
    try { await renameSession(session.path, newName); void load(); }
    catch (err) {
      setSessions((prev) => prev.map((s) => s.path === session.path ? { ...s, name: session.name } : s));
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section class="sessions-page">
      <header class="sessions-header">
        <h1>Sesiones</h1>
        <button class="sessions-new" onClick={createNew}>+ Nueva conversación</button>
        <button class="sessions-back" onClick={() => navigate(appState.activeTabId.value ? 'chat' : 'welcome')}>
          ← Volver
        </button>
      </header>

      <Show when={skipped() && skipped()!.count > 0}>
        <div class="sessions-skip-warning">
          ⚠ {skipped()!.count} archivo(s) de sesión no se pudieron leer (corruptos o vacíos)
        </div>
      </Show>

      <Show when={error()}>
        <div class="sessions-error">
          <span>{error()}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      </Show>

      <div class="sessions-list">
        <div class="sessions-list-inner">
          <Show when={sessions().length === 0} fallback={
            <For each={sessions()}>{(s) => (
              <SessionCard session={s} renamingPath={renamingPath} isActive={s.path === appState.session.value?.file}
                          onSwitch={() => switchTo(s)} onDelete={() => handleDelete(s)}
                          onRename={(n) => handleRename(s, n)} onStartRename={() => setRenamingPath(s.path)} onCancelRename={() => setRenamingPath(null)} />
            )}</For>
          }>
            <div class="sessions-empty">
              <p>{appState.workingDir.value ? 'No hay sesiones en este proyecto' : 'Selecciona una carpeta de trabajo'}</p>
            </div>
          </Show>
        </div>
      </div>

      <footer class="sessions-footer">
        <button onClick={() => void load()} disabled={loading()}>↻ Refrescar</button>
        <span class="sessions-status">actualiza cada 30s</span>
      </footer>
    </section>
  );
}

function SessionCard(props: {
  session: SessionInfo; renamingPath: () => string | null; isActive: boolean;
  onSwitch: () => void; onDelete: () => void; onRename: (name: string) => void;
  onStartRename: () => void; onCancelRename: () => void;
}) {
  const s = () => props.session;
  const isRenaming = () => props.renamingPath() === s().path;

  function fmt(unixMs: number): string {
    const d = new Date(unixMs);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function ago(unixMs: number): string {
    const sec = Math.floor((Date.now() - unixMs) / 1000);
    if (sec < 60) return 'hace segundos';
    if (sec < 3600) return `hace ${Math.floor(sec/60)} min`;
    if (sec < 86400) return `hace ${Math.floor(sec/3600)} h`;
    return `hace ${Math.floor(sec/86400)} d`;
  }

  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  return (
    <article classList={{ 'session-card': true, 'is-active': props.isActive }}
             tabIndex={0} role="button"
             onClick={() => props.onSwitch()}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSwitch(); } }}>
      <div class="session-item-header">
        <div class="session-item-name">
          <Show when={!isRenaming()} fallback={
            <RenameInput session={s()} onRename={props.onRename} onCancel={props.onCancelRename} />
          }>
            <span>{s().name ?? fmt(s().created)}</span>
          </Show>
        </div>
        <div class="session-item-actions">
          <button class="session-item-action" title="Renombrar" onClick={(e) => { e.stopPropagation(); props.onStartRename(); }}>{icon('pencil', { size: 14 })}</button>
          <button class="session-item-action session-item-action--danger" title="Borrar" onClick={(e) => { e.stopPropagation(); props.onDelete(); }}>{icon('trash-2', { size: 14 })}</button>
        </div>
      </div>
      <div class="session-item-preview">{(s().messageCount === 0 ? '(sin mensajes)' : truncate(s().firstMessage, 120))}</div>
      <div class="session-item-stats">
        <span>{s().messageCount} mensajes</span>
        <span> · </span>
        <span>{ago(s().modified)}</span>
      </div>
    </article>
  );
}

function RenameInput(props: { session: SessionInfo; onRename: (name: string) => void; onCancel: () => void }) {
  let ref: HTMLInputElement | undefined;
  onMount(() => { ref?.focus(); ref?.select(); });

  return (
    <input ref={ref} class="session-item-name-input" type="text" value={props.session.name ?? ''}
           onClick={(e) => e.stopPropagation()}
           onKeyDown={(e) => {
             if (e.key === 'Enter') { const v = ref?.value.trim(); if (v && v !== props.session.name) props.onRename(v); else props.onCancel(); }
             if (e.key === 'Escape') props.onCancel();
           }}
           onBlur={() => props.onCancel()} />
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
