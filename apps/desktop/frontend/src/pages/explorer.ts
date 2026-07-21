/**
 * explorer.ts — Página de explorador de archivos.
 *
 * Muestra los archivos del workingDir en un layout de dos paneles:
 * - Izquierda: lista de archivos (file-list)
 * - Derecha: preview del archivo seleccionado (file-preview)
 *
 * Por defecto muestra solo lectura. Botón "Editar" activa modo edición.
 */

import { signal } from 'xi-ui/lib/signal.ts';
import { createScope, type Scope, type Page } from 'xi-ui/lib/scope.ts';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { listFiles, readFile, writeFile } from 'xi-ui/lib/pi/tauri-commands.ts';
import { FileList } from '../components/file-list.ts';
import { FilePreview } from '../components/file-preview.ts';

// Estado local del explorer
const loading = signal<boolean>(false);
const error = signal<string | null>(null);

// Persistencia: último archivo abierto
const STORAGE_KEY = 'xi.explorer';

interface ExplorerState {
  lastFile: string | null;
}

function loadExplorerState(): ExplorerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { lastFile: null };
  } catch {
    return { lastFile: null };
  }
}

function saveExplorerState(state: ExplorerState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function ExplorerPage(): Page {
  const root = document.createElement('div');
  root.className = 'explorer-page';
  const scope = createScope();

  mountExplorer(root, scope);

  scope.add(() => {
    loading.value = false;
    error.value = null;
  });

  return { root, dispose: () => scope.dispose() };
}

/**
 * Monta el explorador (FileList + FilePreview) dentro de un contenedor,
 * con su propio scope. Usable tanto desde la página full-screen como
 * desde el panel lateral del chat.
 */
export function mountExplorer(container: HTMLElement, scope: Scope): void {
  const sidebar = document.createElement('div');
  sidebar.className = 'explorer-sidebar';
  sidebar.append(FileList(scope));

  const content = document.createElement('div');
  content.className = 'explorer-content';
  content.append(FilePreview(scope));

  container.append(sidebar, content);

  const cwd = appState.workingDir.value;
  if (cwd) {
    void loadFiles(cwd);

    const saved = loadExplorerState();
    if (saved.lastFile) {
      scope.add(appState.files.subscribe((files) => {
        if (files.length > 0 && !appState.selectedFile.value) {
          const file = files.find(f => f.path === saved.lastFile);
          if (file && !file.is_dir) {
            void selectFile(file);
          }
        }
      }));
    }
  }
}

// ─── Carga de archivos ─────────────────────────────────────────

export async function loadFiles(dirPath: string): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const files = await listFiles(dirPath);
    appState.files.value = files;
    appState.explorerPath.value = dirPath;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

// ─── Selección de archivo ──────────────────────────────────────

export async function selectFile(file: FileEntry): Promise<void> {
  if (file.is_dir) {
    // Navegar al subdirectorio
    const cwd = appState.workingDir.value;
    if (cwd) {
      const fullPath = `${cwd}/${file.path}`;
      await loadFiles(fullPath);
    }
    return;
  }

  appState.selectedFile.value = file;
  appState.isEditing.value = false;
  appState.fileContent.value = null;

  // Guardar último archivo abierto
  saveExplorerState({ lastFile: file.path });

  // Cargar contenido
  const cwd = appState.workingDir.value;
  if (cwd) {
    try {
      const content = await readFile(`${cwd}/${file.path}`);
      appState.fileContent.value = content;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }
}
