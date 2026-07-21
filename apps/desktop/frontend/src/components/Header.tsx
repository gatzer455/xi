/**
 * Header.tsx — Top bar del app shell.
 */
import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { appState, setActiveTab, type Session } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { pickAndOpenProject } from '../lib/workdir.ts';
import { dropStore } from 'xi-ui/lib/chat/stores.ts';
import { abortPi } from '../lib/pi/index.ts';

export function Header() {
  return (
    <div class="top-bar">
      <img class="top-bar-logo" src="/xi-icon.svg" alt="xi" width={28} height={28}
           style={{ cursor: 'pointer' }} title="Inicio"
           onClick={() => navigate('welcome')} />
      <ProjectCard />
      <Tabs />
      <SettingsBtn />
    </div>
  );
}

function ProjectCard() {
  const [dir, setDir] = createSignal(appState.workingDir.value);
  onCleanup(appState.workingDir.subscribe(setDir));

  return (
    <button class="top-bar-project"
            title={dir() ?? 'Haz click para seleccionar una carpeta de trabajo'}
            onClick={() => pickAndOpenProject().catch(console.error)}>
      {dir() ? dir()!.split('/').pop()! : 'Seleccionar proyecto'}
    </button>
  );
}

function Tabs() {
  const [tabs, setTabs] = createSignal(appState.openTabs.value);
  const [activeId, setActiveId] = createSignal(appState.activeTabId.value);
  const [wd, setWd] = createSignal(appState.workingDir.value);

  onCleanup(appState.openTabs.subscribe(setTabs));
  onCleanup(appState.activeTabId.subscribe(setActiveId));
  onCleanup(appState.workingDir.subscribe(setWd));

  return (
    <div class="top-bar-tabs">
      <For each={tabs()}>
        {(tab) => <TabItem tab={tab} isActive={tab.id === activeId()} />}
      </For>
      <Show when={tabs().length > 0}>
        <button class="top-bar-new-btn" title="Ver historial de conversaciones"
                onClick={() => navigate('sessions')}>
          +<span style="margin-left:4px">Historial</span>
        </button>
        <Show when={wd()}>
          <button class="top-bar-new-btn" title="Explorador de archivos"
                  onClick={() => navigate('explorer')}>
            📁<span style="margin-left:4px">Archivos</span>
          </button>
        </Show>
      </Show>
    </div>
  );
}

function TabItem(props: { tab: Session; isActive: boolean }) {
  const name = () => props.tab.name ?? tabDisplayName(props.tab);
  const title = () => props.tab.file ?? name();

  return (
    <div classList={{ 'top-bar-tab': true, 'top-bar-tab--active': props.isActive }}>
      <button class="top-bar-tab-label" title={title()}
              onClick={() => { setActiveTab(props.tab.id); navigate('chat'); }}>
        {name()}
      </button>
      <button class="top-bar-tab-close" title="Cerrar tab"
              onClick={(ev) => { ev.stopPropagation(); closeTab(props.tab); }}>
        ×
      </button>
    </div>
  );
}

function closeTab(tab: Session): void {
  const tabs = appState.openTabs.value;
  const idx = tabs.findIndex(t => t.id === tab.id);
  if (idx === -1) return;

  const wasActive = appState.activeTabId.value === tab.id;
  const wasStreaming = appState.isStreaming.value && wasActive;

  if (wasStreaming) abortPi().catch(() => {});

  const newTabs = tabs.filter(t => t.id !== tab.id);
  appState.openTabs.value = newTabs;
  dropStore(tab.id);

  if (wasActive) {
    const nextId = newTabs[idx]?.id ?? newTabs[idx - 1]?.id ?? null;
    if (nextId) {
      setActiveTab(nextId);
      navigate('chat');
    } else {
      setActiveTab(null);
      appState.session.value = null;
      navigate('sessions');
    }
  }
}

function SettingsBtn() {
  const [isActive, setIsActive] = createSignal(appState.currentView.value === 'settings');
  onCleanup(appState.currentView.subscribe((v) => setIsActive(v === 'settings')));

  return (
    <button classList={{ 'top-bar-settings': true, 'top-bar-settings--active': isActive() }}
            onClick={() => navigate('settings')}>
      ⚙<span style="margin-left:4px">Settings</span>
    </button>
  );
}

function tabDisplayName(session: { file?: string; id: string }): string {
  if (session.file) {
    const basename = session.file.split('/').pop() ?? 'sesión';
    return basename.replace(/\.jsonl$/, '');
  }
  return session.id.slice(0, 8);
}
