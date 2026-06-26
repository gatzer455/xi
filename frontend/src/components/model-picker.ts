/**
 * model-picker.ts — Modal de selección de modelo (Etapa 10).
 *
 * Modal que se abre al clickear el modelo en la context bar.
 * Muestra la lista de modelos disponibles (appState.availableModels)
 * agrupados por proveedor, con búsqueda, navegación por teclado
 * y contexto de ventana.
 *
 * Al seleccionar un modelo, llama a setModel(provider, modelId) y
 * el modal se cierra. El currentModel se actualiza automáticamente
 * via state-sync.
 *
 * Ciclo de vida:
 *   1. El botón de modelo en ChatContextBar crea ModelPicker()
 *   2. Se appendea a document.body como backdrop + panel
 *   3. El usuario busca/navega/selecciona o cierra
 *   4. dispose() remueve del DOM y limpia suscripciones
 */

import { appState, type PiModel } from '../lib/state.ts';
import { setModel } from '../lib/pi/tauri-commands.ts';

export interface ModelPickerHandle {
  readonly root: HTMLElement;
  dispose(): void;
}

export function ModelPicker(): ModelPickerHandle {
  const disposeFns: Array<() => void> = [];
  function disposeAll(): void {
    for (const fn of disposeFns) fn();
    disposeFns.length = 0;
  }

  // ═══ Backdrop ──
  const backdrop = document.createElement('div');
  backdrop.className = 'model-picker-backdrop';
  backdrop.addEventListener('click', () => disposeAll());
  disposeFns.push(() => backdrop.remove());

  // ═══ Panel ──
  const panel = document.createElement('div');
  panel.className = 'model-picker-panel';
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  backdrop.append(panel);

  // ═══ Header ──
  const header = document.createElement('div');
  header.className = 'model-picker-header';
  header.textContent = 'Seleccionar modelo';
  panel.append(header);

  // ═══ Search ──
  const search = document.createElement('input');
  search.className = 'model-picker-search';
  search.type = 'text';
  search.placeholder = 'Buscar modelo…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  panel.append(search);

  // ═══ List container ──
  const list = document.createElement('div');
  list.className = 'model-picker-list';
  panel.append(list);

  // ═══ Footer info ──
  const footer = document.createElement('div');
  footer.className = 'model-picker-footer';
  panel.append(footer);

  // ═══ Render ──
  let selectedIndex = 0;
  let modelEntries: Array<{ provider: string; model: PiModel; label: string }> = [];

  function renderList(filter: string): void {
    const allModels = appState.availableModels.value;
    const current = appState.currentModel.value;
    const q = filter.toLowerCase().trim();

    // Filtrar y agrupar por provider
    const filtered = allModels.filter((m) => {
      if (!q) return true;
      const name = (m.name || m.id).toLowerCase();
      const provider = m.provider.toLowerCase();
      // id también útil para buscar
      return name.includes(q) || provider.includes(q) || m.id.toLowerCase().includes(q);
    });

    // Ordenar por provider, luego por nombre
    filtered.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    modelEntries = filtered.map((m) => ({
      provider: m.provider,
      model: m,
      label: `${m.provider}/${m.name || m.id}`,
    }));

    list.replaceChildren();
    let currentProvider = '';
    let idx = 0;
    const isCurrent = (m: PiModel): boolean =>
      current !== null && m.provider === current.provider && m.id === current.id;

    for (const entry of modelEntries) {
      // Header de provider
      if (entry.provider !== currentProvider) {
        currentProvider = entry.provider;
        const groupHeader = document.createElement('div');
        groupHeader.className = 'model-picker-group';
        groupHeader.textContent = entry.provider;
        list.append(groupHeader);
      }

      const item = document.createElement('button');
      item.className = 'model-picker-item';
      item.type = 'button';
      item.dataset.index = String(idx);

      if (isCurrent(entry.model)) {
        item.classList.add('model-picker-item--active');
        selectedIndex = idx;
      }

      // Nombre
      const nameSpan = document.createElement('span');
      nameSpan.className = 'model-picker-item-name';
      nameSpan.textContent = entry.model.name || entry.model.id;
      item.append(nameSpan);

      // Context window badge
      if (entry.model.contextWindow) {
        const ctxBadge = document.createElement('span');
        ctxBadge.className = 'model-picker-item-ctx';
        const cw = entry.model.contextWindow;
        ctxBadge.textContent = cw >= 1_000_000
          ? `${(cw / 1_000_000).toFixed(0)}M ctx`
          : `${(cw / 1_000).toFixed(0)}K ctx`;
        item.append(ctxBadge);
      }

      // Checkmark si es el actual
      if (isCurrent(entry.model)) {
        const check = document.createElement('span');
        check.className = 'model-picker-item-check';
        check.textContent = '✓';
        item.append(check);
      }

      item.addEventListener('click', () => selectModel(entry.model));
      list.append(item);
      idx++;
    }

    // Footer info
    footer.textContent = filtered.length === 1
      ? '1 modelo'
      : `${filtered.length} modelos`;

    // Si el modelo activo no está en los filtrados, reset a 0
    if (!list.querySelector('.model-picker-item--active')) {
      selectedIndex = 0;
    }

    // Scroll al seleccionado
    const activeItem = list.querySelector('.model-picker-item--active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }

  function selectModel(model: PiModel): void {
    void setModel(model.provider, model.id);
    disposeAll();
  }

  // ═══ Search handler ──
  search.addEventListener('input', () => {
    renderList(search.value);
  });

  // ═══ Keyboard navigation ──
  search.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll<HTMLElement>('.model-picker-item');
    if (items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        items[selectedIndex]?.focus();
        items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        items[selectedIndex]?.focus();
        items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const entry = modelEntries[selectedIndex];
        if (entry) selectModel(entry.model);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        disposeAll();
        break;
      }
    }
  });

  // ═══ Click en item con teclado (Enter desde focus) ──
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const target = e.target as HTMLElement;
      const idx = target.dataset?.index;
      if (idx !== undefined) {
        const entry = modelEntries[Number(idx)];
        if (entry) selectModel(entry.model);
      }
    }
    if (e.key === 'Escape') {
      disposeAll();
    }
  });

  // ═══ Suscripciones ──
  const unsubAvailable = appState.availableModels.subscribe(() => {
    renderList(search.value);
  });
  disposeFns.push(unsubAvailable);

  // ═══ Initial render ──
  renderList('');

  // ═══ Focus search after mount ──
  requestAnimationFrame(() => {
    search.focus();
  });

  // ═══ Traps focus ──
  // (basic: cierra con Escape, ya cubierto arriba)

  document.body.append(backdrop);

  return {
    root: backdrop,
    dispose: disposeAll,
  };
}