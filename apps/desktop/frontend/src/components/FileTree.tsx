/**
 * FileTree.tsx — Árbol de archivos estilo Yazi (SolidJS).
 *
 * - Lazy loading: hijos se cargan al expandir una carpeta.
 * - Carpetas primero, alfabético (natural sort).
 * - Chevrones ▶/▼ para colapsar/expandir.
 * - Teclado: ↑↓ para navegar, Enter/→ para expandir/seleccionar,
 *   ← para colapsar.
 * - Click en archivo → selectFile(), click en carpeta → toggle.
 */
import { createSignal, For, Show, onCleanup } from 'solid-js';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { listFiles, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';
import { getFileIconName, icon } from 'xi-ui/lib/icons.ts';

// ── Lógica de selección de archivo (compartida con ExplorerPage) ──
const STORAGE_KEY = 'xi.explorer';
function saveSt(s: { lastFile: string | null }) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

async function selectFile(file: FileEntry) {
  if (file.is_dir) return;
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

interface TreeNode {
  entry: FileEntry;
  depth: number;
  children: FileEntry[];
  expanded: boolean;
  loading: boolean;
}

function sortEntries(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function FileIcon(props: { isDir: boolean; name: string; size?: number }) {
  let ref: HTMLSpanElement | undefined;
  const name = () => getFileIconName(props.isDir, props.name);
  // Reaccionar si cambia isDir (raro pero correcto)
  onCleanup(() => {});
  queueMicrotask(() => { if (ref) { ref.innerHTML = ''; ref.append(icon(name(), { size: props.size ?? 16 })); } });
  return <span ref={ref} class="file-tree-icon" />;
}

function Chevron(props: { expanded: boolean; loading: boolean }) {
  const name = () => (props.loading ? 'loader' : props.expanded ? 'chevron-down' : 'chevron-right');
  // Usamos span con el icono inline
  let ref: HTMLSpanElement | undefined;
  queueMicrotask(() => { if (ref) { ref.innerHTML = ''; ref.append(icon(name(), { size: 14 })); } });
  return <span ref={ref} class="file-tree-chevron" classList={{ 'file-tree-chevron--loading': props.loading }} />;
}

export function FileTree() {
  const cwd = appState.workingDir.value;
  const [rootFiles, setRootFiles] = createSignal<FileEntry[]>(appState.files.value);
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = createSignal<Map<string, FileEntry[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = createSignal<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = createSignal<string | null>(
    appState.selectedFile.value?.path ?? null,
  );

  // Sincronizar con señales globales
  onCleanup(appState.files.subscribe(setRootFiles));
  onCleanup(appState.selectedFile.subscribe((f) => setSelectedPath(f?.path ?? null)));

  async function toggleDir(dirPath: string) {
    const expanded = expandedDirs();
    if (expanded.has(dirPath)) {
      const next = new Set(expanded);
      next.delete(dirPath);
      setExpandedDirs(next);
      return;
    }
    // Expandir: cargar si no está en cache
    const cache = childrenCache();
    if (!cache.has(dirPath)) {
      setLoadingDirs(new Set([...loadingDirs(), dirPath]));
      try {
        const abs = cwd ? `${cwd}/${dirPath}` : dirPath;
        const files = await listFiles(abs);
        const sorted = sortEntries(files);
        const nextCache = new Map(cache);
        nextCache.set(dirPath, sorted);
        setChildrenCache(nextCache);
      } catch (err) {
        console.error(err);
        return;
      } finally {
        const nextLoading = new Set(loadingDirs());
        nextLoading.delete(dirPath);
        setLoadingDirs(nextLoading);
      }
    }
    const next = new Set(expandedDirs());
    next.add(dirPath);
    setExpandedDirs(next);
  }

  function onItemClick(file: FileEntry) {
    if (file.is_dir) {
      toggleDir(file.path);
    } else {
      selectFile(file);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const items = getVisibleItems();
    if (items.length === 0) return;
    const cur = selectedPath();
    let idx = items.indexOf(cur ?? '');
    if (idx === -1) idx = 0;

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      const nextIdx = Math.min(idx + 1, items.length - 1);
      setSelectedPath(items[nextIdx]);
      scrollToItem(items[nextIdx]);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      const nextIdx = Math.max(idx - 1, 0);
      setSelectedPath(items[nextIdx]);
      scrollToItem(items[nextIdx]);
    } else if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault();
      const f = findEntry(items[idx]);
      if (f && f.is_dir) {
        if (!expandedDirs().has(f.path)) toggleDir(f.path);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'h') {
      e.preventDefault();
      const f = findEntry(items[idx]);
      if (f && f.is_dir && expandedDirs().has(f.path)) {
        toggleDir(f.path);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const f = findEntry(items[idx]);
      if (f) {
        if (f.is_dir) toggleDir(f.path);
        else selectFile(f);
      }
    }
  }

  // Construir lista plana de items visibles para teclado
  function getVisibleItems(): string[] {
    const result: string[] = [];
    function walk(files: FileEntry[], depth: number) {
      for (const f of files) {
        result.push(f.path);
        if (f.is_dir && expandedDirs().has(f.path)) {
          const children = childrenCache().get(f.path) ?? [];
          walk(children, depth + 1);
        }
      }
    }
    walk(rootFiles(), 0);
    return result;
  }

  function findEntry(path: string): FileEntry | undefined {
    function search(files: FileEntry[]): FileEntry | undefined {
      for (const f of files) {
        if (f.path === path) return f;
        if (f.is_dir) {
          const children = childrenCache().get(f.path);
          if (children) {
            const found = search(children);
            if (found) return found;
          }
        }
      }
      return undefined;
    }
    return search(rootFiles());
  }

  function scrollToItem(path: string) {
    const el = document.querySelector(`[data-file-path="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <div class="file-tree" tabIndex={0} onKeyDown={onKeyDown}>
      <FileTreeLevel
        files={rootFiles()}
        depth={0}
        expandedDirs={expandedDirs()}
        childrenCache={childrenCache()}
        loadingDirs={loadingDirs()}
        selectedPath={selectedPath()}
        onToggle={toggleDir}
        onClick={onItemClick}
      />
    </div>
  );
}

function FileTreeLevel(props: {
  files: FileEntry[];
  depth: number;
  expandedDirs: Set<string>;
  childrenCache: Map<string, FileEntry[]>;
  loadingDirs: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onClick: (f: FileEntry) => void;
}) {
  return (
    <For each={props.files}>
      {(file) => (
        <FileTreeNode
          file={file}
          depth={props.depth}
          expandedDirs={props.expandedDirs}
          childrenCache={props.childrenCache}
          loadingDirs={props.loadingDirs}
          selectedPath={props.selectedPath}
          onToggle={props.onToggle}
          onClick={props.onClick}
        />
      )}
    </For>
  );
}

function FileTreeNode(props: {
  file: FileEntry;
  depth: number;
  expandedDirs: Set<string>;
  childrenCache: Map<string, FileEntry[]>;
  loadingDirs: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onClick: (f: FileEntry) => void;
}) {
  const isExpanded = () => props.expandedDirs.has(props.file.path);
  const isLoading = () => props.loadingDirs.has(props.file.path);
  const children = () => props.childrenCache.get(props.file.path) ?? [];
  const paddingLeft = () => `${props.depth * 20 + 8}px`;

  return (
    <>
      <div
        classList={{
          'file-tree-item': true,
          'file-tree-item--selected': props.selectedPath === props.file.path,
          'file-tree-item--dir': props.file.is_dir,
        }}
        style={{ 'padding-left': paddingLeft() }}
        data-file-path={props.file.path}
        onClick={() => props.onClick(props.file)}
      >
        {props.file.is_dir ? (
          <Chevron expanded={isExpanded()} loading={isLoading()} />
        ) : (
          <span class="file-tree-chevron file-tree-chevron--spacer" />
        )}
        <FileIcon isDir={props.file.is_dir} name={props.file.name} />
        <span class="file-tree-name" title={props.file.path}>
          {props.file.name}
        </span>
      </div>
      <Show when={props.file.is_dir && isExpanded() && !isLoading()}>
        <FileTreeLevel
          files={children()}
          depth={props.depth + 1}
          expandedDirs={props.expandedDirs}
          childrenCache={props.childrenCache}
          loadingDirs={props.loadingDirs}
          selectedPath={props.selectedPath}
          onToggle={props.onToggle}
          onClick={props.onClick}
        />
      </Show>
    </>
  );
}
