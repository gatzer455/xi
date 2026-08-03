/**
 * FilePreview.tsx — Visor/editor de archivos con estructura estilo PND.
 */
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { renderMarkdown } from 'xi-ui/lib/markdown.ts';
import { readFile, writeFile } from 'xi-ui/lib/pi/tauri-commands.ts';

type PreviewMode = 'preview' | 'source';

function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  if (parent === '/') return `/${child}`;
  return `${parent}/${child}`;
}

function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith('.md') || name.toLowerCase().endsWith('.markdown');
}

export function FilePreview() {
  const [file, setFile] = createSignal(appState.selectedFile.value);
  const [content, setContent] = createSignal<string | null>(appState.fileContent.value);
  const [draft, setDraft] = createSignal(appState.fileContent.value ?? '');
  const [mode, setMode] = createSignal<PreviewMode>('source');
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  onCleanup(appState.selectedFile.subscribe((next) => {
    setFile(next);
    setDirty(false);
    setMode(next && isMarkdown(next.name) ? 'preview' : 'source');
  }));
  onCleanup(appState.fileContent.subscribe((next) => {
    setContent(next);
    if (!dirty()) setDraft(next ?? '');
  }));

  createEffect(() => {
    const selected = file();
    if (!selected) return;
    setMode(isMarkdown(selected.name) ? 'preview' : 'source');
  });

  function fullPath(): string {
    const selected = file();
    if (!selected) return '';
    const directory = appState.explorerPath.value || appState.workingDir.value || '';
    return joinPath(directory, selected.name);
  }

  function close(): void {
    if (dirty() && !window.confirm('Hay cambios sin guardar. ¿Cerrar sin guardar?')) return;
    appState.selectedFile.value = null;
    appState.fileContent.value = null;
    appState.isEditing.value = false;
  }

  async function save(): Promise<void> {
    if (!file() || saving()) return;
    setSaving(true);
    try {
      const next = draft();
      await writeFile(fullPath(), next);
      setContent(next);
      appState.fileContent.value = next;
      setDirty(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function cancel(): void {
    setDraft(content() ?? '');
    setDirty(false);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === 'q' && mode() === 'preview' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      close();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  }

  onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  document.addEventListener('keydown', onKeyDown);

  return (
    <div class="file-preview">
      <Show when={file()} fallback={<div class="file-preview-empty">Selecciona un archivo para verlo</div>}>
        <div class="file-preview-header">
          <span class="file-preview-title">Archivo</span>
          <span class="file-preview-path" title={fullPath()}>{fullPath()}</span>
          <button class="file-preview-close" type="button" aria-label="Cerrar visor" onClick={close}>×</button>
        </div>

        <div class="file-preview-toolbar">
          <span class="file-preview-name" title={file()!.name}>{file()!.name}</span>
          <div class="file-preview-actions">
            <Show when={isMarkdown(file()!.name)}>
              <div class="file-preview-mode-toggle" role="group" aria-label="Modo del visor">
                <button
                  classList={{ 'file-preview-mode-btn': true, 'file-preview-mode-btn--active': mode() === 'preview' }}
                  type="button"
                  onClick={() => setMode('preview')}
                >
                  Vista previa
                </button>
                <button
                  classList={{ 'file-preview-mode-btn': true, 'file-preview-mode-btn--active': mode() === 'source' }}
                  type="button"
                  onClick={() => setMode('source')}
                >
                  Fuente
                </button>
              </div>
            </Show>
            <Show when={mode() === 'source'}>
              <button class="file-preview-btn" type="button" onClick={cancel} disabled={!dirty()}>Cancelar</button>
              <button class="file-preview-btn file-preview-btn--primary" type="button" onClick={() => void save()} disabled={!dirty() || saving()}>
                {saving() ? 'Guardando…' : 'Guardar'}
              </button>
            </Show>
          </div>
        </div>

        <div class="file-preview-body" classList={{ 'file-preview-body--source': mode() === 'source' }}>
          <Show when={mode() === 'preview'} fallback={
            <div class="file-preview-content file-preview-content--source">
              <Show when={content() !== null} fallback={<div class="file-preview-loading">Cargando...</div>}>
                <textarea
                  class="file-preview-textarea"
                  aria-label={`Fuente de ${file()!.name}`}
                  spellcheck={false}
                  value={draft()}
                  autofocus
                  onInput={(event) => {
                    setDraft(event.currentTarget.value);
                    setDirty(true);
                  }}
                />
              </Show>
            </div>
          }>
            <div class="file-preview-content file-preview-content--preview">
              <Show when={content() !== null} fallback={<div class="file-preview-loading">Cargando...</div>}>
                <Show when={content() !== ''} fallback={<div class="file-preview-empty-file">Archivo vacío</div>}>
                  <article class="file-preview-markdown markdown-body" innerHTML={renderMarkdown(content() ?? '')} />
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
