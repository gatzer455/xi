/**
 * FileTree.tsx — Árbol de archivos (SolidJS).
 *
 * - Lazy loading: hijos se cargan al expandir una carpeta.
 * - Carpetas primero, alfabético (natural sort).
 * - Entrada `..` para subir un nivel (oculta si estamos en el límite).
 * - Breadcrumb clickeable + botón «📁 Proyecto» para volver al root.
 * - Click → toggle expandir/colapsar carpeta.
 * - Teclado:
 *   ↑↓     mover selección
 *   →      depth 0 colapsada → expandir; depth ≥ 1 → cd a carpeta
 *   ←      depth ≥ 1 → colapsar padre; depth 0 colapsada → subir
 *   Enter  carpeta → cd; archivo → abrir preview
 * - Sigue a `appState.workingDir`: si cambia, resetea el árbol.
 */
import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { listFiles, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';
import { getFileIconName, icon } from 'xi-ui/lib/icons.ts';
import { loadFiles } from '../pages/ExplorerPage.tsx';
import { loadExplorerRootLimit } from '../lib/settings-storage.ts';

// ── Helpers de path ──
function dirname(p: string): string {
  if (!p || p === '/') return '/';
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

function joinPath(parent: string, child: string): string {
  if (parent === '/') return `/${child}`;
  return `${parent}/${child}`;
}

function isAtOrAboveLimit(path: string, limit: string): boolean {
  if (!limit) return false; // sin límite
  if (path === limit) return true;
  return path.startsWith(limit + '/');
}

// ── Lógica de selección de archivo ──
const STORAGE_KEY = 'xi.explorer';
function saveSt(s: { lastFile: string | null }) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

async function selectFile(absPath: string, entry: FileEntry) {
  appState.selectedFile.value = entry;
  appState.isEditing.value = false;
  appState.fileContent.value = null;
  saveSt({ lastFile: entry.path });
  try {
    appState.fileContent.value = await readFile(absPath);
  } catch (err) {
    console.error(err);
  }
}

function sortEntries(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function renderIconInto(el: HTMLSpanElement, name: string, size: number) {
  el.innerHTML = '';
  el.append(icon(name, { size }));
}

interface FlatItem {
  entry: FileEntry;
  absPath: string;
  depth: number;
  isUp?: boolean;
}

export function FileTree() {
  const cwd = appState.workingDir.value;
  const limit = loadExplorerRootLimit();
  const [currentPath, setCurrentPath] = createSignal<string>(cwd ?? '');
  const [entries, setEntries] = createSignal<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = createSignal<Map<string, FileEntry[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = createSignal<Set<string>>(new Set());
  const [selectedIdx, setSelectedIdx] = createSignal(0);

  // Cargar directorio
  async function loadDir(path: string) {
    try {
      const files = await listFiles(path);
      setEntries(sortEntries(files));
    } catch (err) {
      console.error(err);
      setEntries([]);
    }
  }

  // Auto-cargar al montar si no hay archivos
  onMount(() => {
    if (appState.files.value.length === 0 && cwd) {
      void loadFiles(cwd);
    }
    if (currentPath()) void loadDir(currentPath());
  });

  // Seguir a workingDir: si cambia, resetear el árbol
  onCleanup(appState.workingDir.subscribe((newCwd) => {
    if (newCwd && newCwd !== currentPath()) {
      setCurrentPath(newCwd);
      setEntries([]);
      setExpandedDirs(new Set<string>());
      setChildrenCache(new Map<string, FileEntry[]>());
      void loadDir(newCwd);
    }
  }));

  // Reaccionar a cambios en appState.files (de loadFiles del factory)
  onCleanup(appState.files.subscribe((files) => {
    if (files.length > 0 && entries().length === 0) {
      setEntries(sortEntries(files));
    }
  }));

  function canGoUp(): boolean {
    const parent = dirname(currentPath());
    if (parent === currentPath()) return false;
    return !isAtOrAboveLimit(parent, limit);
  }

  function goUp() {
    if (!canGoUp()) return;
    const parent = dirname(currentPath());
    setCurrentPath(parent);
    setEntries([]);
    setExpandedDirs(new Set<string>());
    setChildrenCache(new Map<string, FileEntry[]>());
    void loadDir(parent);
  }

  function goTo(path: string) {
    if (isAtOrAboveLimit(path, limit) && path !== currentPath()) return;
    setCurrentPath(path);
    setEntries([]);
    setExpandedDirs(new Set<string>());
    setChildrenCache(new Map<string, FileEntry[]>());
    void loadDir(path);
  }

  async function toggleDir(folderName: string) {
    const exp = expandedDirs();
    if (exp.has(folderName)) {
      const next = new Set(exp);
      next.delete(folderName);
      setExpandedDirs(next);
      return;
    }
    const cache = childrenCache();
    if (!cache.has(folderName)) {
      setLoadingDirs(new Set([...loadingDirs(), folderName]));
      try {
        const absPath = joinPath(currentPath(), folderName);
        const files = await listFiles(absPath);
        const nextCache = new Map(cache);
        nextCache.set(folderName, sortEntries(files));
        setChildrenCache(nextCache);
      } catch (err) {
        console.error(err);
        return;
      } finally {
        const nextLoading = new Set(loadingDirs());
        nextLoading.delete(folderName);
        setLoadingDirs(nextLoading);
      }
    }
    const next = new Set(expandedDirs());
    next.add(folderName);
    setExpandedDirs(next);
  }

  function buildFlatList(): FlatItem[] {
    const result: FlatItem[] = [];
    const exp = expandedDirs();
    const cache = childrenCache();

    // Entrada ".." si podemos subir
    if (canGoUp()) {
      result.push({
        entry: { name: '..', path: '..', is_dir: true, size: 0, modified: 0 },
        absPath: dirname(currentPath()),
        depth: 0,
        isUp: true,
      });
    }

    function walk(files: FileEntry[], parentAbs: string, depth: number) {
      for (const f of files) {
        const absPath = joinPath(parentAbs, f.name);
        result.push({ entry: f, absPath, depth });
        if (f.is_dir && exp.has(f.name)) {
          const kids = cache.get(f.name) ?? [];
          walk(kids, absPath, depth + 1);
        }
      }
    }
    walk(entries(), currentPath(), 0);
    return result;
  }

  function onItemClick(item: FlatItem) {
    if (item.isUp) { goUp(); return; }
    if (item.entry.is_dir) {
      toggleDir(item.entry.name);
    } else {
      void selectFile(item.absPath, item.entry);
    }
  }

  /** Encontrar la carpeta expandida ancestro más cercano (para ←). */
  function findParentExpandedFolder(items: FlatItem[], idx: number): string | null {
    const child = items[idx];
    if (!child || child.depth < 1) return null;
    const exp = expandedDirs();
    for (let i = idx - 1; i >= 0; i--) {
      const candidate = items[i];
      if (candidate.depth < child.depth && candidate.entry.is_dir && exp.has(candidate.entry.name)) {
        return candidate.entry.name;
      }
    }
    return null;
  }

  function onKeyDown(e: KeyboardEvent) {
    const items = buildFlatList();
    if (items.length === 0) return;
    let idx = selectedIdx();
    if (idx < 0 || idx >= items.length) idx = 0;

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      const next = Math.min(idx + 1, items.length - 1);
      setSelectedIdx(next);
      scrollToItem(next);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      const next = Math.max(idx - 1, 0);
      setSelectedIdx(next);
      scrollToItem(next);
    } else if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault();
      const item = items[idx];
      if (item.isUp) return;
      if (item.depth >= 1 && item.entry.is_dir) {
        // cd into child folder
        goTo(item.absPath);
      } else if (item.depth === 0 && item.entry.is_dir && !expandedDirs().has(item.entry.name)) {
        // expand collapsed root folder
        void toggleDir(item.entry.name);
      }
      // depth 0 expanded → no-op; files → no-op
    } else if (e.key === 'ArrowLeft' || e.key === 'h') {
      e.preventDefault();
      const item = items[idx];
      if (item.isUp) return;
      if (item.depth >= 1) {
        // collapse parent expanded folder
        const parent = findParentExpandedFolder(items, idx);
        if (parent) toggleDir(parent);
      } else if (!expandedDirs().has(item.entry.name)) {
        // depth 0, collapsed → go up
        goUp();
      }
      // depth 0, expanded → no-op
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[idx];
      if (item.isUp) { goUp(); return; }
      if (item.entry.is_dir) {
        goTo(item.absPath);
      } else {
        void selectFile(item.absPath, item.entry);
      }
    }
  }

  function scrollToItem(idx: number) {
    const el = document.querySelector(`[data-file-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }

  // Breadcrumb segments
  function breadcrumbSegments(): { name: string; path: string }[] {
    const p = currentPath();
    if (!p) return [];
    const segs: { name: string; path: string }[] = [];
    const parts = p.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      segs.push({ name: part, path: acc });
    }
    return segs;
  }

  const flat = () => buildFlatList();

  return (
    <div class="file-tree" tabIndex={0} onKeyDown={onKeyDown}>
      {/* Breadcrumb + botón Proyecto */}
      <div class="file-tree-header">
        <Show when={cwd && currentPath() !== cwd}>
          <button class="file-tree-project-btn" onClick={() => goTo(cwd!)} title={`Ir a ${cwd}`}>
            📁 Proyecto
          </button>
        </Show>
        <div class="file-tree-breadcrumb">
          <button class="file-tree-bc-root" onClick={() => goTo('/')} title="Raíz del sistema">/</button>
          <For each={breadcrumbSegments()}>
            {(seg) => (
              <>
                <span class="file-tree-bc-sep">/</span>
                <button class="file-tree-bc-item" onClick={() => goTo(seg.path)} title={seg.path}>
                  {seg.name}
                </button>
              </>
            )}
          </For>
        </div>
      </div>

      <Show when={flat().length === 0}>
        <div class="file-list-empty">
          <Show when={cwd} fallback="Abre un proyecto para explorar archivos">
            Directorio vacío
          </Show>
        </div>
      </Show>
      <For each={flat()}>
        {(item, idx) => {
          const f = item.entry;
          const isExpanded = item.isUp ? false : expandedDirs().has(f.name);
          const isLoading = item.isUp ? false : loadingDirs().has(f.name);
          const paddingLeft = `${item.depth * 20 + 8}px`;
          return (
            <div
              classList={{
                'file-tree-item': true,
                'file-tree-item--selected': idx() === selectedIdx(),
                'file-tree-item--dir': f.is_dir,
                'file-tree-item--up': item.isUp,
              }}
              style={{ 'padding-left': paddingLeft }}
              data-file-idx={idx()}
              onClick={() => onItemClick(item)}
            >
              {item.isUp ? (
                <span class="file-tree-chevron file-tree-chevron--up" ref={(el) => {
                  renderIconInto(el, 'arrow-up', 14);
                }} />
              ) : f.is_dir ? (
                <span class="file-tree-chevron" ref={(el) => {
                  renderIconInto(el, isLoading ? 'loader' : isExpanded ? 'chevron-down' : 'chevron-right', 14);
                }} />
              ) : (
                <span class="file-tree-chevron file-tree-chevron--spacer" />
              )}
              {item.isUp ? null : (
                <span class="file-tree-icon" ref={(el) => {
                  renderIconInto(el, getFileIconName(f.is_dir, f.name), 16);
                }} />
              )}
              <span class="file-tree-name" title={item.absPath}>
                {f.name}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
