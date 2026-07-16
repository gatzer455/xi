/**
 * explorer.ts — Explorador de archivos read-only (mobile).
 *
 * Simplificado de apps/desktop/frontend/src/pages/explorer.ts: sin
 * edición (mobile no tiene write_file — xi-serve es read-only, ver
 * packages/xi-serve/CLAUDE.md § files.rs).
 */
import { createScope, type Page } from 'xi-ui/lib/scope.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { listFiles, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';

export function ExplorerPage(): Page {
  const root = document.createElement('div');
  root.className = 'explorer-page';
  const scope = createScope();

  const header = document.createElement('header');
  header.className = 'explorer-header';
  const backBtn = document.createElement('button');
  backBtn.textContent = '← Volver';
  backBtn.addEventListener('click', () => navigate('chat'));
  header.append(backBtn);
  const pathLabel = document.createElement('span');
  pathLabel.className = 'explorer-path';
  header.append(pathLabel);
  root.append(header);

  const list = document.createElement('div');
  list.className = 'explorer-list';
  root.append(list);

  const preview = document.createElement('pre');
  preview.className = 'explorer-preview';
  preview.style.display = 'none';
  root.append(preview);

  let currentPath = '';

  void loadDir('');

  async function loadDir(relPath: string): Promise<void> {
    const cwd = appState.workingDir.value;
    if (!cwd) return;
    currentPath = relPath;
    preview.style.display = 'none';
    pathLabel.textContent = relPath || '/';
    try {
      const full = relPath ? `${cwd}/${relPath}` : cwd;
      const entries = await listFiles(full);
      renderList(entries);
    } catch (err) {
      list.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  function renderList(entries: FileEntry[]): void {
    list.replaceChildren();

    if (currentPath) {
      const up = document.createElement('button');
      up.className = 'explorer-item';
      up.textContent = '.. (subir)';
      up.addEventListener('click', () => {
        const parent = currentPath.split('/').slice(0, -1).join('/');
        void loadDir(parent);
      });
      list.append(up);
    }

    for (const entry of entries) {
      const item = document.createElement('button');
      item.className = 'explorer-item';
      item.textContent = entry.is_dir ? `📁 ${entry.name}` : `📄 ${entry.name}`;
      item.addEventListener('click', () => {
        if (entry.is_dir) {
          void loadDir(entry.path);
        } else {
          void openFile(entry);
        }
      });
      list.append(item);
    }
  }

  async function openFile(entry: FileEntry): Promise<void> {
    const cwd = appState.workingDir.value;
    if (!cwd) return;
    try {
      const content = await readFile(`${cwd}/${entry.path}`);
      preview.textContent = content;
      preview.style.display = 'block';
    } catch (err) {
      preview.textContent = err instanceof Error ? err.message : String(err);
      preview.style.display = 'block';
    }
  }

  return { root, dispose: () => scope.dispose() };
}
