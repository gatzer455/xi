/**
 * FileList.tsx — Lista de archivos del explorador (SolidJS).
 */
import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { listFiles, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';
import { getFileIconName, icon } from 'xi-ui/lib/icons.ts';

function FileIcon(props: { isDir: boolean; name: string; size?: number }) {
  let ref: HTMLSpanElement | undefined;
  onMount(() => { if (ref) ref.append(icon(getFileIconName(props.isDir, props.name), { size: props.size ?? 16 })); });
  return <span ref={ref} class="file-item-icon" />;
}

export function FileList() {
  const [files, setFiles] = createSignal(appState.files.value);
  const [path, setPath] = createSignal(appState.explorerPath.value);
  const [selectedPath, setSelectedPath] = createSignal(appState.selectedFile.value?.path ?? null);
  const cwd = appState.workingDir.value;

  onCleanup(appState.files.subscribe(setFiles));
  onCleanup(appState.explorerPath.subscribe(setPath));
  onCleanup(appState.selectedFile.subscribe((f) => setSelectedPath(f?.path ?? null)));

  async function navTo(dir: string) {
    try {
      const f = await listFiles(dir);
      appState.files.value = f;
      appState.explorerPath.value = dir;
      appState.selectedFile.value = null;
      appState.fileContent.value = null;
    } catch (err) { console.error(err); }
  }

  async function onFileClick(file: FileEntry) {
    if (file.is_dir) {
      const base = appState.explorerPath.value;
      const full = file.path ? `${base}/${file.path}` : base;
      if (full) await navTo(full);
      return;
    }
    appState.selectedFile.value = file;
    appState.isEditing.value = false;
    const base = appState.explorerPath.value;
    if (base) {
      try {
        appState.fileContent.value = await readFile(`${base}/${file.name}`);
      } catch (err) { console.error(err); appState.fileContent.value = null; }
    }
  }

  // Breadcrumb
  const relative = () => {
    if (!cwd || !path()) return [];
    const r = path()!.slice(cwd.length).replace(/^\//, '');
    return r ? r.split('/').filter(Boolean) : [];
  };

  return (
    <div class="file-list">
      <Show when={cwd}>
        <div class="file-breadcrumb">
          <button class="file-breadcrumb-item" onClick={() => navTo(cwd!)}>
            📂 Proyecto
          </button>
          <For each={relative()}>{(part, i) => {
            const parts = relative();
            const fullPath = cwd + '/' + parts.slice(0, i() + 1).join('/');
            return <><span class="file-breadcrumb-sep">/</span><button class="file-breadcrumb-item" onClick={() => navTo(fullPath)}>{part}</button></>;
          }}</For>
        </div>
      </Show>

      <Show when={files().length === 0}>
        <div class="file-list-empty">Directorio vacío</div>
      </Show>

      <For each={files()}>
        {(file) => (
          <div classList={{ 'file-item': true, 'file-item--active': file.path === selectedPath() }}
               onClick={() => onFileClick(file)}>
            <FileIcon isDir={file.is_dir} name={file.name} />
            <span class="file-item-name" title={file.path}>{file.name}</span>
            <Show when={!file.is_dir}>
              <span class="file-item-size">{fmtSize(file.size)}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
