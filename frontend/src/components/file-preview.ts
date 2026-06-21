/**
 * file-preview.ts — Preview del archivo seleccionado.
 *
 * Muestra el contenido del archivo:
 * - Markdown: renderizado con renderMarkdown
 * - Otros: texto plano
 *
 * Incluye botón "Editar" para activar modo edición.
 */

import { appState } from '../lib/state.ts';
import type { Scope } from '../lib/scope.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { writeFile } from '../lib/pi/tauri-commands.ts';
import { icon } from '../lib/icons.ts';

export function FilePreview(scope: Scope): HTMLElement {
  const container = document.createElement('div');
  container.className = 'file-preview';

  const render = () => {
    container.replaceChildren();

    const file = appState.selectedFile.value;
    const content = appState.fileContent.value;
    const isEditing = appState.isEditing.value;

    if (!file) {
      container.append(renderEmpty());
      return;
    }

    // Header con nombre del archivo y acciones
    container.append(renderHeader(file));

    // Contenido
    if (isEditing) {
      container.append(renderEditor(content ?? ''));
    } else {
      container.append(renderContent(file, content));
    }
  };

  scope.add(appState.selectedFile.subscribe(render));
  scope.add(appState.fileContent.subscribe(render));
  scope.add(appState.isEditing.subscribe(render));
  render();

  return container;
}

function renderEmpty(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'file-preview-empty';
  const emptyIcon = icon('file', { size: 48, color: 'var(--color-text-muted)' });
  emptyIcon.setAttribute('class', 'file-preview-empty-icon');
  
  const emptyText = document.createElement('div');
  emptyText.className = 'file-preview-empty-text';
  emptyText.textContent = 'Seleccioná un archivo para verlo';
  
  empty.append(emptyIcon, emptyText);
  return empty;
}

function renderHeader(file: { name: string; path: string }): HTMLElement {
  const header = document.createElement('div');
  header.className = 'file-preview-header';

  const name = document.createElement('span');
  name.className = 'file-preview-name';
  name.textContent = file.name;

  const actions = document.createElement('div');
  actions.className = 'file-preview-actions';

  if (appState.isEditing.value) {
    // Modo edición: Guardar + Cancelar
    const saveBtn = document.createElement('button');
    saveBtn.className = 'file-preview-btn file-preview-btn--primary';
    saveBtn.textContent = 'Guardar';
    saveBtn.addEventListener('click', () => void handleSave());

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'file-preview-btn';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => {
      appState.isEditing.value = false;
      // Recargar contenido original
      const cwd = appState.workingDir.value;
      if (cwd && file) {
        import('../lib/pi/tauri-commands.ts').then(({ readFile }) => {
          readFile(`${cwd}/${file.path}`).then((content) => {
            appState.fileContent.value = content;
          });
        });
      }
    });

    actions.append(saveBtn, cancelBtn);
  } else {
    // Modo lectura: Editar
    const editBtn = document.createElement('button');
    editBtn.className = 'file-preview-btn';
    editBtn.append(icon('pencil', { size: 14 }), ' Editar');
    editBtn.addEventListener('click', () => {
      appState.isEditing.value = true;
    });
    actions.append(editBtn);
  }

  header.append(name, actions);
  return header;
}

function renderContent(file: { name: string }, content: string | null): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-preview-content';

  if (content === null) {
    const loading = document.createElement('div');
    loading.className = 'file-preview-loading';
    loading.textContent = 'Cargando...';
    wrapper.append(loading);
    return wrapper;
  }

  if (content === '') {
    const empty = document.createElement('div');
    empty.className = 'file-preview-empty-file';
    empty.textContent = 'Archivo vacío';
    wrapper.append(empty);
    return wrapper;
  }

  // Renderizar según tipo de archivo
  const isMarkdown = file.name.endsWith('.md');

  if (isMarkdown) {
    const rendered = document.createElement('div');
    rendered.className = 'file-preview-markdown markdown-body';
    rendered.innerHTML = renderMarkdown(content);
    wrapper.append(rendered);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'file-preview-code';
    pre.textContent = content;
    wrapper.append(pre);
  }

  return wrapper;
}

function renderEditor(content: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-preview-editor';

  const textarea = document.createElement('textarea');
  textarea.className = 'file-preview-textarea';
  textarea.value = content;
  textarea.spellcheck = false;

  // Auto-expand
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 800) + 'px';
  });

  wrapper.append(textarea);

  // Focus y expandir al montar
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.style.height = Math.min(textarea.scrollHeight, 800) + 'px';
  });

  return wrapper;
}

async function handleSave(): Promise<void> {
  const file = appState.selectedFile.value;
  const cwd = appState.workingDir.value;
  if (!file || !cwd) return;

  const textarea = document.querySelector('.file-preview-textarea') as HTMLTextAreaElement | null;
  if (!textarea) return;

  const content = textarea.value;

  try {
    await writeFile(`${cwd}/${file.path}`, content);
    appState.fileContent.value = content;
    appState.isEditing.value = false;
  } catch (err) {
    console.error('Error saving file:', err);
  }
}
