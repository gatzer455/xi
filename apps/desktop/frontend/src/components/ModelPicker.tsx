/**
 * ModelPicker.tsx — Modal de selección de modelo (SolidJS).
 */
import { createSignal, createMemo, For, Show, onMount, onCleanup } from 'solid-js';
import { appState, type PiModel } from 'xi-ui/lib/state.ts';
import { setModel } from 'xi-ui/lib/pi/tauri-commands.ts';

export function ModelPicker(props: { onClose: () => void }) {
  const [query, setQuery] = createSignal('');
  const [idx, setIdx] = createSignal(0);
  const [models, setModels] = createSignal<PiModel[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [currentModel, setCurrentModel] = createSignal(appState.currentModel.value);

  onCleanup(appState.availableModels.subscribe(setModels));
  onCleanup(appState.currentModel.subscribe(setCurrentModel));

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    const all = models();
    const f = q ? all.filter(m => m.name?.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : all;
    return f.sort((a, b) => a.provider.localeCompare(b.provider) || (a.name || a.id).localeCompare(b.name || b.id));
  });

  const current = currentModel;

  async function select(m: PiModel) {
    try {
      await setModel(m.provider, m.id);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onKey(e: KeyboardEvent) {
    const items = filtered();
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && items[idx()]) { e.preventDefault(); select(items[idx()]); }
    if (e.key === 'Escape') { props.onClose(); }
  }

  let searchRef: HTMLInputElement | undefined;
  onMount(() => searchRef?.focus());

  return (
    <div class="model-picker-backdrop" onClick={props.onClose}>
      <div class="model-picker-panel" onClick={(e) => e.stopPropagation()}>
        <div class="model-picker-header">Seleccionar modelo</div>
        <input ref={searchRef} class="model-picker-search" type="text" placeholder="Buscar modelo…"
               autocomplete="off" spellcheck={false}
               onInput={(e) => { setQuery(e.currentTarget.value); setIdx(0); }}
               onKeyDown={onKey} />
        <div class="model-picker-list">
          <For each={filtered()}>{(m, i) => {
            const isActive = () => i() === idx();
            const isCurrent = () => current()?.provider === m.provider && current()?.id === m.id;
            return (
              <button classList={{ 'model-picker-item': true, 'model-picker-item--active': isActive() }}
                      onClick={() => select(m)}>
                <span class="model-picker-item-name">{m.name || m.id}</span>
                <Show when={m.contextWindow}>
                  <span class="model-picker-item-ctx">
                    {m.contextWindow! >= 1_000_000
                      ? `${(m.contextWindow! / 1_000_000).toFixed(0)}M ctx`
                      : `${(m.contextWindow! / 1_000).toFixed(0)}K ctx`}
                  </span>
                </Show>
                <Show when={isCurrent()}><span class="model-picker-item-check">✓</span></Show>
              </button>
            );
          }}</For>
        </div>
        <Show when={error()}><div class="model-picker-error">{error()}</div></Show>
        <div class="model-picker-footer">{filtered().length} modelo{filtered().length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  );
}
