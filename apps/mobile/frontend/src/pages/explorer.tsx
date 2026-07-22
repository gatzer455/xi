/**
 * explorer.tsx — Explorador de archivos read-only (mobile).
 *
 * Simplificado de apps/desktop/frontend/src/pages/explorer.ts: sin
 * edición (mobile no tiene write_file — xi-serve es read-only).
 */
import { createSignal, For, Show } from 'solid-js';
import { navigate } from 'xi-ui/lib/nav.ts';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { listFiles, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';

export function ExplorerPage() {
  const [entries, setEntries] = createSignal<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = createSignal('');
  const [preview, setPreview] = createSignal('');
  const [showPreview, setShowPreview] = createSignal(false);
  const [error, setError] = createSignal('');

  void loadDir('');

  async function loadDir(relPath: string) {
    const cwd = appState.workingDir.value;
    if (!cwd) return;
    setCurrentPath(relPath);
    setShowPreview(false);
    setError('');
    try {
      const full = relPath ? `${cwd}/${relPath}` : cwd;
      setEntries(await listFiles(full));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openFile(entry: FileEntry) {
    const cwd = appState.workingDir.value;
    if (!cwd) return;
    try {
      setPreview(await readFile(`${cwd}/${entry.path}`));
      setShowPreview(true);
    } catch (err) {
      setPreview(err instanceof Error ? err.message : String(err));
      setShowPreview(true);
    }
  }

  return (
    <div class="explorer-page">
      <header class="explorer-header">
        <button class="back-btn" onClick={() => navigate('chat')}>
          ← Volver
        </button>
        <span class="explorer-path">{currentPath() || '/'}</span>
      </header>
      <Show when={!showPreview()}>
        <div class="explorer-list">
          {error() && <p>{error()}</p>}
          <Show when={currentPath()}>
            <button class="explorer-item" onClick={() => {
              const parent = currentPath().split('/').slice(0, -1).join('/');
              void loadDir(parent);
            }}>
              .. (subir)
            </button>
          </Show>
          <For each={entries()}>
            {(entry) => (
              <button
                class="explorer-item"
                onClick={() => entry.is_dir ? void loadDir(entry.path) : void openFile(entry)}
              >
                {entry.is_dir ? '📁 ' : '📄 '}{entry.name}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={showPreview()}>
        <pre class="explorer-preview">{preview()}</pre>
      </Show>
    </div>
  );
}
