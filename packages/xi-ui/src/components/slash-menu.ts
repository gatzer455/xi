/**
 * slash-menu.ts — Dropdown de autocomplete para slash commands.
 *
 * Se monta pegado al textarea del input bar. Muestra comandos filtrados
 * mientras el usuario escribe después de `/`. Navegable con ↑↓ y Enter.
 *
 * API:
 *   SlashMenu(onSelect) → { el, visible, open, update, close, moveUp, moveDown, selectHighlighted }
 *
 * Puro DOM, sin signals — el estado (highlight, filtro) es interno.
 * Reutilizable en desktop y mobile (misma firma que los demás componentes).
 */
// ponytail: add grouped sections (builtins / extensions) when item count > 10

export interface SlashMenuItem {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface SlashMenuHandle {
  el: HTMLElement;
  visible: boolean;
  open(items: SlashMenuItem[], query: string): void;
  update(items: SlashMenuItem[], query: string): void;
  close(): void;
  moveUp(): void;
  moveDown(): void;
  selectHighlighted(): void;
}

export function SlashMenu(onSelect: (item: SlashMenuItem) => void): SlashMenuHandle {
  const el = document.createElement('div');
  el.className = 'slash-menu';
  el.hidden = true;

  let filtered: SlashMenuItem[] = [];
  let highlightedIdx = 0;
  const MAX_VISIBLE = 8;

  function render(items: SlashMenuItem[], query: string): void {
    const q = query.toLowerCase();
    filtered = q
      ? items.filter(i => i.name.toLowerCase().includes(q))
      : [...items];

    el.innerHTML = '';
    if (filtered.length === 0) {
      el.hidden = true;
      return;
    }

    highlightedIdx = 0;
    const max = Math.min(filtered.length, MAX_VISIBLE);

    for (let i = 0; i < max; i++) {
      const item = filtered[i];

      const row = document.createElement('div');
      row.className = 'slash-menu-item';
      if (i === highlightedIdx) row.classList.add('slash-menu-item--highlighted');

      const nameRow = document.createElement('div');
      nameRow.className = 'slash-menu-name-row';

      const slash = document.createElement('span');
      slash.className = 'slash-menu-slash';
      slash.textContent = '/';
      nameRow.append(slash);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'slash-menu-name';
      nameSpan.textContent = item.name;
      nameRow.append(nameSpan);

      if (item.argumentHint) {
        const argSpan = document.createElement('span');
        argSpan.className = 'slash-menu-arg';
        argSpan.textContent = ` ${item.argumentHint}`;
        nameRow.append(argSpan);
      }

      row.append(nameRow);

      if (item.description) {
        const descSpan = document.createElement('span');
        descSpan.className = 'slash-menu-desc';
        descSpan.textContent = item.description;
        row.append(descSpan);
      }

      // mousedown (no click) para que el preventDefault evite el blur
      // del textarea antes de que se procese la selección.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onSelect(item);
      });

      el.append(row);
    }
    el.hidden = false;
  }

  function updateHighlight(): void {
    const rows = el.querySelectorAll<HTMLElement>('.slash-menu-item');
    rows.forEach((r, i) => r.classList.toggle('slash-menu-item--highlighted', i === highlightedIdx));
  }

  // ── Scroll into view ──────────────────────────────────────────

  function scrollToHighlighted(): void {
    const rows = el.querySelectorAll<HTMLElement>('.slash-menu-item');
    const target = rows[highlightedIdx];
    if (!target) return;
    target.scrollIntoView({ block: 'nearest' });
  }

  return {
    el,
    get visible() { return !el.hidden; },

    open(items: SlashMenuItem[], query: string): void {
      render(items, query);
    },

    update(items: SlashMenuItem[], query: string): void {
      // Solo re-renderizar si cambió el query; si solo cambió la lista
      // (get_commands respondió a mitad de tipeo), actualizar igual.
      render(items, query);
    },

    close(): void {
      el.hidden = true;
      filtered = [];
    },

    moveUp(): void {
      if (filtered.length === 0) return;
      highlightedIdx = highlightedIdx > 0 ? highlightedIdx - 1 : filtered.length - 1;
      updateHighlight();
      scrollToHighlighted();
    },

    moveDown(): void {
      if (filtered.length === 0) return;
      highlightedIdx = highlightedIdx < filtered.length - 1 ? highlightedIdx + 1 : 0;
      updateHighlight();
      scrollToHighlighted();
    },

    selectHighlighted(): void {
      if (filtered.length === 0) return;
      onSelect(filtered[highlightedIdx]);
    },
  };
}
