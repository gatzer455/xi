/**
 * ExplorerPage.tsx — Página de explorador de archivos (SolidJS).
 */
import { createScope } from 'xi-ui/lib/scope.ts';
import type { Page } from 'xi-ui/lib/scope.ts';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { listFiles, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';
import { FileList } from '../components/FileList.tsx';
import { FilePreview } from '../components/FilePreview.tsx';

const STORAGE_KEY = 'xi.explorer';
interface State { lastFile: string | null }
function loadSt(): State { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{"lastFile":null}'); } catch { return { lastFile: null }; } }
function saveSt(s: State) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

export async function loadFiles(dir: string) {
  try {
    appState.files.value = await listFiles(dir);
    appState.explorerPath.value = dir;
  } catch (err) { console.error(err); }
}

export async function selectFile(file: FileEntry) {
  if (file.is_dir) {
    const cwd = appState.workingDir.value;
    if (cwd) await loadFiles(`${cwd}/${file.path}`);
    return;
  }
  appState.selectedFile.value = file;
  appState.isEditing.value = false;
  appState.fileContent.value = null;
  saveSt({ lastFile: file.path });
  const cwd = appState.workingDir.value;
  if (cwd) {
    try { appState.fileContent.value = await readFile(`${cwd}/${file.path}`); }
    catch (err) { console.error(err); }
  }
}

/** Factory compat: Page { root, dispose } para VanillaPage wrapper */
export function explorerPageFactory(): Page {
  const root = document.createElement('div');
  root.className = 'explorer-page';
  const scope = createScope();
  const cwd = appState.workingDir.value;
  if (cwd) void loadFiles(cwd);
  // En full-page mode, montamos ambos paneles side by side
  const listDiv = document.createElement('div'); listDiv.className = 'explorer-list'; listDiv.id = 'explorer-list';
  const previewDiv = document.createElement('div'); previewDiv.className = 'explorer-preview'; previewDiv.id = 'explorer-preview';
  root.append(listDiv, previewDiv);
  return { root, dispose: () => scope.dispose() };
}

export function mountExplorer(container: HTMLElement, _scope: unknown): void {
  // Bridge: vanilla mountExplorer API → renderizar componente SolidJS
  // Usamos un div simple y montamos el componente inline.
  // La limpieza depende del llamador (chat.ts maneja su propio scope).
  let view: 'list' | 'preview' = 'list';
  const listDiv = document.createElement('div'); listDiv.className = 'explorer-list';
  const previewDiv = document.createElement('div'); previewDiv.className = 'explorer-preview';
  const backBtn = document.createElement('button'); backBtn.className = 'explorer-preview-back';
  backBtn.textContent = '← Volver';
  backBtn.onclick = () => { appState.selectedFile.value = null; appState.fileContent.value = null; appState.isEditing.value = false; showList(); };
  previewDiv.append(backBtn);

  function showList() { view = 'list'; container.replaceChildren(listDiv); listDiv.replaceChildren(); /* FileList vanilla mount handled by caller */ }
  function showPreview() { view = 'preview'; container.replaceChildren(previewDiv); }

  appState.selectedFile.subscribe((f) => {
    if (f && !f.is_dir) showPreview();
    else if (!f && view === 'preview') showList();
  });

  showList();
  const cwd = appState.workingDir.value;
  if (cwd) { void loadFiles(cwd);
    const saved = loadSt();
    if (saved.lastFile) {
      appState.files.subscribe((files) => {
        if (files.length > 0 && !appState.selectedFile.value) {
          const f = files.find(x => x.path === saved.lastFile);
          if (f && !f.is_dir) void selectFile(f);
        }
      });
    }
  }
}
