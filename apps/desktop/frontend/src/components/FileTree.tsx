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

// ── Lógica de selección de archivo ──
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

function sortEntries(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** Icono inline en span */
function renderIconInto(el: HTMLSpanElement, name: string, size: number) {
  el.innerHTML = '';
  el.append(icon(name, { size }));
}

export function FileTree() {
  const cwd = appState.workingDir.value;

  // Estado plano: todas las entradas visibles con su profundidad
  const [entries, setEntries] = createSignal<{ entry: FileEntry; depth: number }[]>([]);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [childrenCache, setChildrenCache] = createSignal<Map<string, FileEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = createSignal<Set<string>>(new Set());

  // Sincronizar desde appState.files cuando cambien
  onCleanup(appState.files.subscribe((files) => {
    const flat = files.map((f) => ({ entry: f, depth: 0 }));
    setEntries(flat);
    // Limpiar cache de hijos si cambió la raíz
    setChildrenCache(new Map());
    setExpandedDirs(new Set<string>());
  }));

  // Reconstruir entries planos desde el cache cada vez que cambien
  function rebuild() {
    const root = appState.files.value;
    const result: { entry: FileEntry; depth: number }[] = [];
    function walk(files: FileEntry[], depth: number) {
      for (const f of files) {
        result.push({ entry: f, depth });
        if (f.is_dir && expandedDirs().has(f.path)) {
          const kids = childrenCache().get(f.path);
          if (kids) walk(kids, depth + 1);
        }
      }
    }
    walk(root, 0);
    setEntries(result);
  }

  async function toggleDir(dirPath: string) {
    const expanded = expandedDirs();
    if (expanded.has(dirPath)) {
      const next = new Set(expanded);
      next.delete(dirPath);
      setExpandedDirs(next);
      // Re-render sin los hijos
      rebuild();
      return;
    }
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
    rebuild();
  }

  function onItemClick(entry: FileEntry) {
    if (entry.is_dir) {
      toggleDir(entry.path);
    } else {
      selectFile(entry);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const items = entries();
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
      const f = items[idx].entry;
      if (f.is_dir && !expandedDirs().has(f.path)) toggleDir(f.path);
    } else if (e.key === 'ArrowLeft' || e.key === 'h') {
      e.preventDefault();
      const f = items[idx].entry;
      if (f.is_dir && expandedDirs().has(f.path)) toggleDir(f.path);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const f = items[idx].entry;
      if (f.is_dir) toggleDir(f.path);
      else selectFile(f);
    }
  }

  function scrollToItem(idx: number) {
    const el = document.querySelector(`[data-file-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <div class="file-tree" tabIndex={0} onKeyDown={onKeyDown}>
      <Show when={entries().length === 0}>
        <div class="file-list-empty">Directorio vacío</div>
      </Show>
      <For each={entries()}>
        {(item, idx) => {
          const f = item.entry;
          const isExpanded = expandedDirs().has(f.path);
          const isLoading = loadingDirs().has(f.path);
          const paddingLeft = `${item.depth * 20 + 8}px`;
          return (
            <div
              classList={{
                'file-tree-item': true,
                'file-tree-item--selected': idx() === selectedIdx(),
                'file-tree-item--dir': f.is_dir,
              }}
              style={{ 'padding-left': paddingLeft }}
              data-file-idx={idx()}
              data-file-path={f.path}
              onClick={() => onItemClick(f)}
            >
              {f.is_dir ? (
                <span class="file-tree-chevron" ref={(el) => {
                  renderIconInto(el, isLoading ? 'loader' : isExpanded ? 'chevron-down' : 'chevron-right', 14);
                }} />
              ) : (
                <span class="file-tree-chevron file-tree-chevron--spacer" />
              )}
              <span class="file-tree-icon" ref={(el) => {
                renderIconInto(el, getFileIconName(f.is_dir, f.name), 16);
              }} />
              <span class="file-tree-name" title={f.path}>{f.name}</span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
