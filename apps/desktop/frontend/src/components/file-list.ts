/**
 * file-list.ts — Lista de archivos del explorador.
 *
 * Muestra la lista de archivos y subdirectorios del workingDir.
 * Click en archivo → seleccionar y mostrar preview.
 * Click en directorio → navegar dentro.
 */

import { appState, type FileEntry } from 'xi-ui/lib/state.ts';
import type { Scope } from 'xi-ui/lib/scope.ts';
import { listFiles, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';
import { icon, getFileIconName } from 'xi-ui/lib/icons.ts';

export function FileList(scope: Scope): HTMLElement {
  const container = document.createElement('div');
  container.className = 'file-list';

  const render = () => {
    container.replaceChildren();

    // Breadcrumb
    container.append(renderBreadcrumb(scope));

    const files = appState.files.value;
    if (files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'file-list-empty';
      empty.textContent = 'Directorio vacío';
      container.append(empty);
      return;
    }

    for (const file of files) {
      container.append(renderFileItem(file));
    }
  };

  scope.add(appState.files.subscribe(render));
  scope.add(appState.explorerPath.subscribe(render));
  render();

  return container;
}

function renderBreadcrumb(scope: Scope): HTMLElement {
  const nav = document.createElement('div');
  nav.className = 'file-breadcrumb';

  const cwd = appState.workingDir.value;
  const currentPath = appState.explorerPath.value;

  if (!cwd || !currentPath) return nav;

  // Obtener partes del path relativo al workingDir
  const relativePath = currentPath.slice(cwd.length).replace(/^\//, '');
  const parts = relativePath ? relativePath.split('/').filter(Boolean) : [];

  // Botón raíz
  const rootBtn = document.createElement('button');
  rootBtn.className = 'file-breadcrumb-item';
  const rootIcon = icon('folder-open', { size: 14, color: 'var(--color-text-muted)' });
  rootBtn.append(rootIcon, ' Proyecto');
  rootBtn.addEventListener('click', () => {
    void navigateToDir(cwd);
  });
  nav.append(rootBtn);

  // Partes del path
  let accumulated = cwd;
  for (const part of parts) {
    const separator = document.createElement('span');
    separator.className = 'file-breadcrumb-sep';
    separator.textContent = '/';
    nav.append(separator);

    accumulated += `/${part}`;
    const btn = document.createElement('button');
    btn.className = 'file-breadcrumb-item';
    btn.textContent = part;
    const path = accumulated;
    btn.addEventListener('click', () => {
      void navigateToDir(path);
    });
    nav.append(btn);
  }

  return nav;
}

async function navigateToDir(path: string): Promise<void> {
  try {
    const files = await listFiles(path);
    appState.files.value = files;
    appState.explorerPath.value = path;
    appState.selectedFile.value = null;
    appState.fileContent.value = null;
  } catch (err) {
    console.error('Error navigating:', err);
  }
}

function renderFileItem(file: FileEntry): HTMLElement {
  const item = document.createElement('div');
  item.className = 'file-item';
  if (appState.selectedFile.value?.path === file.path) {
    item.classList.add('file-item--active');
  }

  // Icono (Lucide SVG)
  const iconName = getFileIcon(file);
  const iconEl = icon(iconName, { size: 16, color: 'var(--color-text-muted)' });
  iconEl.setAttribute('class', 'file-item-icon');

  // Nombre
  const name = document.createElement('span');
  name.className = 'file-item-name';
  name.textContent = file.name;
  name.title = file.path;

  // Tamaño (solo archivos)
  const size = document.createElement('span');
  size.className = 'file-item-size';
  if (!file.is_dir) {
    size.textContent = formatSize(file.size);
  }

  item.append(iconEl, name, size);

  // Click handler
  item.addEventListener('click', () => {
    void handleFileClick(file);
  });

  return item;
}

function getFileIcon(file: FileEntry): string {
  return getFileIconName(file.is_dir, file.name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function handleFileClick(file: FileEntry): Promise<void> {
  if (file.is_dir) {
    // Navegar al subdirectorio usando explorerPath actual
    const currentPath = appState.explorerPath.value;
    if (currentPath) {
      const fullPath = file.path ? `${currentPath}/${file.path}` : currentPath;
      try {
        const files = await listFiles(fullPath);
        appState.files.value = files;
        appState.explorerPath.value = fullPath;
        appState.selectedFile.value = null;
        appState.fileContent.value = null;
      } catch (err) {
        console.error('Error loading directory:', err);
      }
    }
    return;
  }

  // Seleccionar archivo
  appState.selectedFile.value = file;
  appState.isEditing.value = false;

  // Cargar contenido usando explorerPath actual
  const currentPath = appState.explorerPath.value;
  if (currentPath) {
    try {
      const content = await readFile(`${currentPath}/${file.name}`);
      appState.fileContent.value = content;
    } catch (err) {
      console.error('Error reading file:', err);
      appState.fileContent.value = null;
    }
  }
}
