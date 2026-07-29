/**
 * plugin-loader.ts — Carga plugins de xi en runtime.
 *
 * Llama al comando Tauri `get_plugins`, lee el entry JS de cada
 * plugin vía `read_plugin_entry`, crea un Blob URL y lo importa
 * como módulo ESM dinámico.
 *
 * Cada plugin exporta `register(api)` donde `api` contiene las
 * funciones que el plugin puede usar (registerPaneType, etc.).
 */

import { invoke } from '@tauri-apps/api/core';
import { type Component } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import type { TabId, PaneId, SessionPath } from 'xi-ui/lib/state.ts';
import { registerPaneType } from '../components/PaneView.tsx';
import { addEntry } from 'xi-ui/lib/debug-panel.ts';

export interface PluginInfo {
  name: string;
  version: string;
  sidecarPath: string;
  entryPath: string;
  installed: boolean;
}

export interface PluginApi {
  registerPaneType: (type: string, comp: Component<{ tabId?: TabId | string; paneId?: PaneId | string; sessionId?: SessionPath | string }>, label?: string) => void;
  /** Devuelve el directorio de trabajo actual, o null si no hay proyecto abierto. */
  getWorkingDir: () => string | null;
}

export interface PluginModule {
  register: (api: PluginApi) => void | Promise<void>;
}

/**
 * Carga todos los plugins instalados.
 */
export async function loadPlugins(): Promise<void> {
  const plugins: PluginInfo[] = await invoke('get_plugins');
  addEntry('system', `plugins: ${plugins.length} descubierto(s)`);

  for (const plugin of plugins) {
    if (!plugin.installed) {
      addEntry('system', `plugin ${plugin.name}: no instalado (falta binario o entry)`);
      continue;
    }

    try {
      const js = await invoke<string>('read_plugin_entry', {
        pluginName: plugin.name,
      });

      // Blob URL: el JS se carga como módulo ESM en el mismo origin.
      const blob = new Blob([js], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);

      const mod: PluginModule = await import(/* @vite-ignore */ url);
      URL.revokeObjectURL(url);

      const api: PluginApi = { registerPaneType, getWorkingDir: () => appState.workingDir.value };
      await mod.register(api);

      addEntry('system', `plugin ${plugin.name}: registrado`);
    } catch (err) {
      addEntry('system', `plugin ${plugin.name}: error al cargar — ${err}`);
    }
  }
}
