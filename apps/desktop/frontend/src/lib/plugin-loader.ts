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
  registerPaneType: typeof registerPaneType;
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

      const api: PluginApi = { registerPaneType };
      await mod.register(api);

      addEntry('system', `plugin ${plugin.name}: registrado`);
    } catch (err) {
      addEntry('system', `plugin ${plugin.name}: error al cargar — ${err}`);
    }
  }
}
