/**
 * FileTree.tsx — Navegador de archivos estilo PND.
 *
 * Un directorio por vez: las carpetas navegan, no se expanden inline.
 * La misma colección se puede representar como lista o grilla.
 */
import { createEffect, createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import { listFiles, readFile, renameFile, deleteFile } from 'xi-ui/lib/pi/tauri-commands.ts';
import { getFileIconName, icon } from 'xi-ui/lib/icons.ts';
import { loadExplorerRootLimit } from '../lib/settings-storage.ts';

type ViewMode = 'list' | 'grid';

const VIEW_MODE_KEY = 'xi.explorer.viewMode';
const STORAGE_KEY = 'xi.explorer';

function loadViewMode(): ViewMode {
  return localStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list';
}

function saveLastFile(path: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ lastFile: path }));
}

function dirname(path: string): string {
  if (!path || path === '/') return '/';
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function joinPath(parent: string, child: string): string {
  if (parent === '/') return `/${child}`;
  return `${parent}/${child}`;
}

function isAtOrAboveLimit(path: string, limit: string): boolean {
  if (!limit) return false;
  return path === limit || path.startsWith(`${limit}/`);
}

function sortEntries(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function formatSize(entry: FileEntry): string {
  if (entry.is_dir) return '—';
  if (entry.size < 1024) return `${entry.size} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = entry.size / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

const dateFormatter = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatModified(timestamp: number): string {
  return timestamp > 0 ? dateFormatter.format(new Date(timestamp)).replace('.', '') : '—';
}

function renderIconInto(el: HTMLElement, name: string, size: number): void {
  el.replaceChildren(icon(name, { size }));
}

async function selectFile(absPath: string, entry: FileEntry): Promise<void> {
  appState.selectedFile.value = entry;
  appState.isEditing.value = false;
  appState.fileContent.value = null;
  saveLastFile(entry.path);
  try {
    appState.fileContent.value = await readFile(absPath);
  } catch (err) {
    console.error(err);
  }
}

export function FileTree() {
  let rootRef: HTMLDivElement | undefined;
  const projectRoot = appState.workingDir.value ?? '';
  const limit = loadExplorerRootLimit();
  const [currentPath, setCurrentPath] = createSignal(projectRoot);
  const [projectPath, setProjectPath] = createSignal(projectRoot);
  const [entries, setEntries] = createSignal<FileEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [viewMode, setViewMode] = createSignal<ViewMode>(loadViewMode());
  const [renamingIdx, setRenamingIdx] = createSignal(-1);
  const [renameValue, setRenameValue] = createSignal('');
  let renameCancelled = false;
  let loadId = 0;
  let lastClick = 0;
  let lastIndex = -1;
  let viewButton: HTMLButtonElement | undefined;

  createEffect(() => {
    const mode = viewMode();
    if (viewButton) renderIconInto(viewButton, mode === 'list' ? 'layout-grid' : 'list', 17);
  });

  function setView(mode: ViewMode): void {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  async function loadDir(path: string): Promise<void> {
    const id = ++loadId;
    try {
      const files = sortEntries(await listFiles(path));
      if (id !== loadId) return;
      setEntries(files);
      setSelectedIdx(0);
      appState.files.value = files;
      appState.explorerPath.value = path;
    } catch (err) {
      if (id !== loadId) return;
      console.error(err);
      setEntries([]);
    }
  }

  function canGoUp(): boolean {
    const path = currentPath();
    const parent = dirname(path);
    if (parent === path) return false;
    return !isAtOrAboveLimit(parent, limit);
  }

  function goTo(path: string): void {
    if (!path || path === currentPath()) return;
    if (isAtOrAboveLimit(path, limit) && path !== projectPath()) return;
    setCurrentPath(path);
    void loadDir(path);
  }

  function goUp(): void {
    if (canGoUp()) goTo(dirname(currentPath()));
  }

  function openEntry(entry: FileEntry, index: number): void {
    setSelectedIdx(index);
    const now = Date.now();
    const isDoubleClick = !entry.is_dir && index === lastIndex && now - lastClick < 400;
    lastClick = now;
    lastIndex = index;

    if (entry.is_dir) {
      goTo(joinPath(currentPath(), entry.name));
    } else if (isDoubleClick) {
      void selectFile(joinPath(currentPath(), entry.name), entry);
    }
  }

  function openSelected(): void {
    const entry = entries()[selectedIdx()];
    if (!entry) return;
    if (entry.is_dir) goTo(joinPath(currentPath(), entry.name));
    else void selectFile(joinPath(currentPath(), entry.name), entry);
  }

  function startRename(index: number, entry: FileEntry): void {
    setRenamingIdx(index);
    setRenameValue(entry.name);
  }

  async function commitRename(index: number): Promise<void> {
    const entry = entries()[index];
    if (!entry) return;
    const next = renameValue().trim();
    setRenamingIdx(-1);
    if (!next || next === entry.name) return;
    try {
      await renameFile(joinPath(currentPath(), entry.name), next);
      await loadDir(currentPath());
    } catch (err) {
      console.error(err);
      window.alert(String(err));
    }
  }

  async function deleteEntry(index: number): Promise<void> {
    const entry = entries()[index];
    if (!entry) return;
    const msg = entry.is_dir
      ? `¿Eliminar la carpeta "${entry.name}" y todo su contenido?`
      : `¿Eliminar "${entry.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteFile(joinPath(currentPath(), entry.name));
      await loadDir(currentPath());
    } catch (err) {
      console.error(err);
      window.alert(String(err));
    }
  }

  function gridColumns(): number {
    const grid = rootRef?.querySelector<HTMLElement>('.file-grid');
    if (!grid) return 1;
    return Math.max(1, Math.floor((grid.clientWidth + 16) / 196));
  }

  function scrollToSelected(): void {
    rootRef?.querySelector(`[data-file-idx="${selectedIdx()}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function onKeyDown(event: KeyboardEvent): void {
    const items = entries();
    if (items.length === 0) return;
    // Durante un rename, el input maneja sus propias teclas. Ignorar
    // cualquier keydown que provenga del input (WebKitGTK puede escapar
    // el Enter del input hacia el contenedor) o que llegue mientras el
    // rename está activo — evita que el Enter abra el archivo al confirmar.
    if (renamingIdx() >= 0) {
      // Fallback: si el input no tiene foco (WebKitGTK), Esc cancela el rename.
      if (event.key === 'Escape') setRenamingIdx(-1);
      return;
    }
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const index = selectedIdx();
    const columns = viewMode() === 'grid' ? gridColumns() : 1;
    let next = index;

    if (event.key === 'ArrowDown' || event.key === 'j') next = Math.min(index + columns, items.length - 1);
    else if (event.key === 'ArrowUp' || event.key === 'k') next = Math.max(index - columns, 0);
    else if (event.key === 'ArrowRight' || event.key === 'l') {
      if (viewMode() === 'grid') next = Math.min(index + 1, items.length - 1);
      else { event.preventDefault(); openSelected(); return; }
    } else if (event.key === 'ArrowLeft' || event.key === 'h') {
      if (viewMode() === 'grid') next = Math.max(index - 1, 0);
      else { event.preventDefault(); goUp(); return; }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openSelected();
      return;
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      goUp();
      return;
    } else if (event.key === 'F2') {
      event.preventDefault();
      const entry = entries()[selectedIdx()];
      if (entry) startRename(selectedIdx(), entry);
      return;
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void deleteEntry(selectedIdx());
      return;
    } else {
      return;
    }

    event.preventDefault();
    if (next !== index) {
      setSelectedIdx(next);
      requestAnimationFrame(scrollToSelected);
    }
  }

  function breadcrumbSegments(): { name: string; path: string }[] {
    const parts = currentPath().split('/').filter(Boolean);
    const segments: { name: string; path: string }[] = [];
    let path = '';
    for (const part of parts) {
      path += `/${part}`;
      segments.push({ name: part, path });
    }
    return segments;
  }

  onMount(() => {
    rootRef?.focus();
    if (currentPath()) void loadDir(currentPath());
  });

  onCleanup(appState.workingDir.subscribe((cwd) => {
    if (!cwd || cwd === projectPath()) return;
    setProjectPath(cwd);
    setCurrentPath(cwd);
    setEntries([]);
    void loadDir(cwd);
  }));

  return (
    <div ref={rootRef} class="file-tree" tabIndex={0} onKeyDown={onKeyDown}>
      <div class="file-tree-header">
        <div class="file-tree-breadcrumb" aria-label="Ruta actual">
          <button class="file-tree-bc-root" onClick={() => goTo(projectPath())} title="Proyecto">
            {projectPath().split('/').filter(Boolean).pop() ?? 'Proyecto'}
          </button>
          <For each={breadcrumbSegments().filter((segment) => segment.path !== projectPath())}>
            {(segment) => (
              <>
                <span class="file-tree-bc-sep">/</span>
                <button class="file-tree-bc-item" onClick={() => goTo(segment.path)} title={segment.path}>
                  {segment.name}
                </button>
              </>
            )}
          </For>
        </div>
        <div class="file-tree-view-toggle">
          <button
            class="file-tree-view-btn"
            title={viewMode() === 'list' ? 'Vista grilla' : 'Vista lista'}
            aria-label={viewMode() === 'list' ? 'Vista grilla' : 'Vista lista'}
            onClick={() => setView(viewMode() === 'list' ? 'grid' : 'list')}
            ref={(el) => {
              viewButton = el;
              renderIconInto(el, viewMode() === 'list' ? 'layout-grid' : 'list', 17);
            }}
          />
        </div>
      </div>

      <div class="file-tree-content">
        <Show when={entries().length > 0} fallback={<div class="file-list-empty">Directorio vacío</div>}>
          <Show when={viewMode() === 'list'} fallback={
            <div class="file-grid">
              <For each={entries()}>
                {(entry, index) => (
                  <div
                    classList={{
                      'file-grid-item': true,
                      'file-grid-item--dir': entry.is_dir,
                      'file-grid-item--selected': selectedIdx() === index(),
                    }}
                    data-file-idx={index()}
                    onClick={() => openEntry(entry, index())}
                  >
                    <Show when={renamingIdx() === index()} fallback={
                      <span class="file-grid-actions">
                        <button
                          class="file-table-action"
                          title="Renombrar (F2)"
                          aria-label={`Renombrar ${entry.name}`}
                          onClick={(e) => { e.stopPropagation(); startRename(index(), entry); }}
                          ref={(el) => renderIconInto(el, 'pencil', 14)}
                        />
                        <button
                          class="file-table-action"
                          title="Eliminar (Supr)"
                          aria-label={`Eliminar ${entry.name}`}
                          onClick={(e) => { e.stopPropagation(); void deleteEntry(index()); }}
                          ref={(el) => renderIconInto(el, 'trash-2', 14)}
                        />
                      </span>
                    }>
                      <input
                        class="file-tree-rename-input file-tree-rename-input--grid"
                        value={renameValue()}
                        onInput={(e) => setRenameValue(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (e.key === 'Enter') { renameCancelled = false; e.currentTarget.blur(); }
                          else if (e.key === 'Escape') { renameCancelled = true; e.currentTarget.blur(); }
                        }}
                        onBlur={() => {
                          if (renameCancelled) { renameCancelled = false; setRenamingIdx(-1); return; }
                          void commitRename(index());
                        }}
                        ref={(el) => { requestAnimationFrame(() => { el.focus(); el.select(); }); }}
                      />
                    </Show>
                    <span class="file-grid-icon" ref={(el) => renderIconInto(el, getFileIconName(entry.is_dir, entry.name), 42)} />
                    <span class="file-grid-name" title={entry.name}>{entry.name}</span>
                  </div>
                )}
              </For>
            </div>
          }>
            <div class="file-table" role="table">
              <div class="file-table-head" role="row">
                <span>Nombre</span>
                <span>Tamaño</span>
                <span>Modificado</span>
                <span />
              </div>
              <For each={entries()}>
                {(entry, index) => (
                  <div
                    classList={{
                      'file-table-row': true,
                      'file-table-row--dir': entry.is_dir,
                      'file-table-row--selected': selectedIdx() === index(),
                    }}
                    data-file-idx={index()}
                    role="row"
                    onClick={() => openEntry(entry, index())}
                  >
                    <span class="file-table-name" title={entry.name}>
                      <span class="file-table-icon" ref={(el) => renderIconInto(el, getFileIconName(entry.is_dir, entry.name), 20)} />
                      <Show when={renamingIdx() === index()} fallback={
                        <>
                          <span>{entry.name}</span>
                          <span class="file-table-actions">
                            <button
                              class="file-table-action"
                              title="Renombrar (F2)"
                              aria-label={`Renombrar ${entry.name}`}
                              onClick={(e) => { e.stopPropagation(); startRename(index(), entry); }}
                              ref={(el) => renderIconInto(el, 'pencil', 14)}
                            />
                            <button
                              class="file-table-action"
                              title="Eliminar (Supr)"
                              aria-label={`Eliminar ${entry.name}`}
                              onClick={(e) => { e.stopPropagation(); void deleteEntry(index()); }}
                              ref={(el) => renderIconInto(el, 'trash-2', 14)}
                            />
                          </span>
                        </>
                      }>
                        <input
                          class="file-tree-rename-input"
                          value={renameValue()}
                          onInput={(e) => setRenameValue(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            if (e.key === 'Enter') { renameCancelled = false; e.currentTarget.blur(); }
                            else if (e.key === 'Escape') { renameCancelled = true; e.currentTarget.blur(); }
                          }}
                          onBlur={() => {
                            if (renameCancelled) { renameCancelled = false; setRenamingIdx(-1); return; }
                            void commitRename(index());
                          }}
                          ref={(el) => { requestAnimationFrame(() => { el.focus(); el.select(); }); }}
                        />
                      </Show>
                    </span>
                    <span class="file-table-size">{formatSize(entry)}</span>
                    <span class="file-table-date">{formatModified(entry.modified)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      <div class="file-tree-status">
        {entries().length} {entries().length === 1 ? 'archivo' : 'archivos'}
      </div>

      <Show when={renamingIdx() >= 0}>
        <div class="file-tree-rename-overlay" />
      </Show>
    </div>
  );
}
