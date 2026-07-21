/**
 * FilePreview.tsx — Preview del archivo seleccionado (SolidJS).
 */
import { createSignal, createEffect, Show, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { renderMarkdown } from 'xi-ui/lib/markdown.ts';
import { writeFile, readFile } from 'xi-ui/lib/pi/tauri-commands.ts';

export function FilePreview() {
  const [file, setFile] = createSignal(appState.selectedFile.value);
  const [content, setContent] = createSignal<string | null>(appState.fileContent.value);
  const [editing, setEditing] = createSignal(appState.isEditing.value);

  onCleanup(appState.selectedFile.subscribe(setFile));
  onCleanup(appState.fileContent.subscribe(setContent));
  onCleanup(appState.isEditing.subscribe(setEditing));

  async function save() {
    const f = file();
    const cwd = appState.workingDir.value;
    if (!f || !cwd) return;
    const ta = document.querySelector('.file-preview-textarea') as HTMLTextAreaElement | null;
    if (!ta) return;
    try {
      await writeFile(`${cwd}/${f.path}`, ta.value);
      appState.fileContent.value = ta.value;
      appState.isEditing.value = false;
    } catch (err) { console.error(err); }
  }

  function cancel() {
    appState.isEditing.value = false;
    const cwd = appState.workingDir.value;
    if (cwd && file()) {
      readFile(`${cwd}/${file()!.path}`).then((c) => appState.fileContent.value = c).catch(() => appState.fileContent.value = null);
    }
  }

  return (
    <div class="file-preview">
      <Show when={file()}
            fallback={
              <div class="file-preview-empty">
                <div class="file-preview-empty-text">Selecciona un archivo para verlo</div>
              </div>
            }>
        <div class="file-preview-header">
          <span class="file-preview-name">{file()?.name}</span>
          <div class="file-preview-actions">
            <Show when={editing()}
                  fallback={
                    <button class="file-preview-btn" onClick={() => appState.isEditing.value = true}>
                      ✏️ Editar
                    </button>
                  }>
              <button class="file-preview-btn file-preview-btn--primary" onClick={save}>Guardar</button>
              <button class="file-preview-btn" onClick={cancel}>Cancelar</button>
            </Show>
          </div>
        </div>

        <Show when={editing()}>
          <Editor content={content() ?? ''} />
        </Show>

        <Show when={!editing() && file()}>
          <ContentView name={file()!.name} content={content()} />
        </Show>
      </Show>
    </div>
  );
}

function ContentView(props: { name: string; content: string | null }) {
  if (props.content === null) return <div class="file-preview-loading">Cargando...</div>;
  if (props.content === '') return <div class="file-preview-empty-file">Archivo vacío</div>;

  if (props.name.endsWith('.md')) {
    return <div class="file-preview-markdown markdown-body" innerHTML={renderMarkdown(props.content)} />;
  }
  return <pre class="file-preview-code">{props.content}</pre>;
}

function Editor(props: { content: string }) {
  let taRef: HTMLTextAreaElement | undefined;

  function onInput() {
    if (!taRef) return;
    taRef.style.height = 'auto';
    taRef.style.height = Math.min(taRef.scrollHeight, 800) + 'px';
  }

  createEffect(() => {
    if (!taRef) return;
    taRef.value = props.content;
    taRef.style.height = Math.min(taRef.scrollHeight, 800) + 'px';
    setTimeout(() => taRef?.focus(), 0);
  });

  return <textarea ref={taRef} class="file-preview-textarea" spellcheck={false} onInput={onInput} />;
}
