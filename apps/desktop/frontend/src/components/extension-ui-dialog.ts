/**
 * extension-ui-dialog.ts — UI components para extension_ui_request.
 *
 * Cada función renderiza un HTMLElement que se inserta dentro del chat.
 * El dialog es modal — el input del chat se deshabilita mientras está activo.
 *
 * Todos los components usan inline styles (regla del proyecto).
 * Layout: flexbox, padding, gap.
 */

import type {
  ExtensionUISelectRequest,
  ExtensionUIConfirmRequest,
  ExtensionUIInputRequest,
  ExtensionUIEditorRequest,
} from '../lib/pi/types.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

type DialogResolve = (value: Record<string, unknown>) => void;
type DialogReject = () => void;

// ─── Select Dialog ────────────────────────────────────────────────────────────

/**
 * Renderiza un dialog de selección con radio buttons.
 *
 * Muestra el title, las options como radio buttons, y "Other (type your own)"
 * como última opción. Si el usuario elige "Other", aparece un input de texto.
 */
export function renderSelectDialog(
  request: ExtensionUISelectRequest,
  resolve: DialogResolve,
  reject: DialogReject,
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `
    border: 1px solid var(--color-border, #333);
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
    background: var(--color-surface, #1a1a1a);
  `;

  // Title
  const title = document.createElement('div');
  title.style.cssText = `font-weight: 600; margin-bottom: 12px; font-size: 14px;`;
  title.textContent = request.title;
  container.appendChild(title);

  // Options — pi-ask ya agrega 'Other (type your own)' a las opciones
  const options = [...request.options];
  let cursorIndex = 0;
  let isEditingOther = false;
  let otherInput: HTMLInputElement | null = null;
  const otherIndex = options.findIndex(o => o.toLowerCase().includes('other'));

  // Build option rows
  const optionRows: HTMLElement[] = [];
  const optionsContainer = document.createElement('div');
  optionsContainer.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const optionRow = document.createElement('div');
    optionRow.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      padding: 4px 8px; border-radius: 4px;
    `;

    const bullet = document.createElement('span');
    bullet.textContent = '○';
    bullet.style.cssText = `color: var(--color-muted, #999); font-size: 14px;`;

    const label = document.createElement('span');
    label.textContent = option;
    label.style.cssText = `font-size: 14px; flex: 1;`;

    optionRow.appendChild(bullet);
    optionRow.appendChild(label);

    // Other option gets a text input
    if (i === otherIndex) {
      otherInput = document.createElement('input');
      otherInput.type = 'text';
      otherInput.placeholder = 'Escribí tu respuesta...';
      otherInput.style.cssText = `
        flex: 1; padding: 6px 10px; border: 1px solid var(--color-border, #333);
        border-radius: 4px; background: var(--color-bg, #0a0a0a);
        color: var(--color-text, #e0e0e0); font-size: 14px;
        display: none;
      `;
      // Enter en el input = confirmar, Escape = volver al selector
      otherInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const value = otherInput!.value.trim();
          if (value) resolve({ value });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          isEditingOther = false;
          render();
          // Re-focus al container para que las flechas funcionen
          container.focus();
        }
      });
      optionRow.appendChild(otherInput);
    }

    // Click handler — check this option (no resolve, user must press Enter)
    optionRow.addEventListener('click', (e) => {
      e.preventDefault();
      checkOption(i);
    });
    optionRow.style.cursor = 'pointer';

    optionsContainer.appendChild(optionRow);
    optionRows.push(optionRow);
  }

  container.appendChild(optionsContainer);

  // ─── Rendering ────────────────────────────────────────────────
  function render() {
    for (let i = 0; i < optionRows.length; i++) {
      const row = optionRows[i];
      const bullet = row.querySelector('span') as HTMLSpanElement;
      const isActive = i === cursorIndex;

      row.style.background = isActive ? 'var(--color-hover, rgba(255,255,255,0.05))' : '';
      bullet.textContent = isActive ? '●' : '○';
      bullet.style.color = isActive ? 'var(--color-accent, #4a9eff)' : 'var(--color-muted, #999)';

      // Other input visibility
      if (i === otherIndex && otherInput) {
        otherInput.style.display = isActive && isEditingOther ? 'block' : 'none';
      }
    }
  }

  // ─── Keyboard ─────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    // If editing Other input, handle separately
    if (isEditingOther && otherInput) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // Evitar que chat.ts lo capture
        isEditingOther = false;
        render();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const value = otherInput.value.trim();
        if (value) resolve({ value });
        return;
      }
      return; // Let input handle other keys
    }

    // Navigation mode
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursorIndex = Math.min(cursorIndex + 1, options.length - 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursorIndex = Math.max(cursorIndex - 1, 0);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (cursorIndex === otherIndex) {
        isEditingOther = true;
        render();
        otherInput?.focus();
      } else {
        resolve({ value: options[cursorIndex] });
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      reject();
    }
  }

  // ─── Click handlers (mouse support) ───────────────────────────
  // Click solo marca la opción (como check), no resuelve.
  // El usuario debe presionar Enter o click en "Seleccionar" para confirmar.
  function checkOption(index: number) {
    cursorIndex = index;
    render();
    if (index === otherIndex) {
      isEditingOther = true;
      render();
      otherInput?.focus();
    }
  }

  // ─── Buttons (for mouse users) ───────────────────────────────
  const buttons = document.createElement('div');
  buttons.style.cssText = `display: flex; gap: 8px; margin-top: 16px;`;

  const selectBtn = document.createElement('button');
  selectBtn.textContent = 'Seleccionar';
  selectBtn.style.cssText = `
    padding: 8px 16px; border: none; border-radius: 4px;
    background: var(--color-accent, #4a9eff); color: var(--color-accent-fg, #fff);
    cursor: pointer; font-size: 14px;
  `;
  selectBtn.addEventListener('click', () => {
    if (cursorIndex === otherIndex && otherInput) {
      const value = otherInput.value.trim();
      if (value) resolve({ value });
    } else {
      resolve({ value: options[cursorIndex] });
    }
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.style.cssText = `
    padding: 8px 16px; border: 1px solid var(--color-border, #333);
    border-radius: 4px; background: transparent; color: var(--color-text, #e0e0e0);
    cursor: pointer; font-size: 14px;
  `;
  cancelBtn.addEventListener('click', () => reject());

  buttons.appendChild(selectBtn);
  buttons.appendChild(cancelBtn);
  container.appendChild(buttons);

  // ─── Init ─────────────────────────────────────────────────────
  container.setAttribute('tabindex', '0');
  container.addEventListener('keydown', handleKeyDown);

  // Auto-focus for immediate keyboard navigation
  setTimeout(() => container.focus(), 50);
  render();

  return container;
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

/**
 * Renderiza un dialog de confirmación sí/no.
 *
 * Muestra el title, el message, y dos botones: "Sí" y "No".
 */
export function renderConfirmDialog(
  request: ExtensionUIConfirmRequest,
  resolve: DialogResolve,
  reject: DialogReject,
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `
    border: 1px solid var(--color-border, #333);
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
    background: var(--color-surface, #1a1a1a);
  `;

  // Title
  const title = document.createElement('div');
  title.style.cssText = `font-weight: 600; margin-bottom: 8px; font-size: 14px;`;
  title.textContent = request.title;
  container.appendChild(title);

  // Message
  const message = document.createElement('div');
  message.style.cssText = `font-size: 14px; color: var(--color-muted, #999); margin-bottom: 16px;`;
  message.textContent = request.message;
  container.appendChild(message);

  // Buttons
  const buttons = document.createElement('div');
  buttons.style.cssText = `display: flex; gap: 8px;`;

  const yesBtn = document.createElement('button');
  yesBtn.textContent = 'Sí';
  yesBtn.style.cssText = `
    padding: 8px 16px; border: none; border-radius: 4px;
    background: var(--color-accent, #4a9eff); color: var(--color-accent-fg, #fff);
    cursor: pointer; font-size: 14px;
  `;
  yesBtn.addEventListener('click', () => resolve({ confirmed: true }));

  const noBtn = document.createElement('button');
  noBtn.textContent = 'No';
  noBtn.style.cssText = `
    padding: 8px 16px; border: 1px solid var(--color-border, #333);
    border-radius: 4px; background: transparent; color: var(--color-text, #e0e0e0);
    cursor: pointer; font-size: 14px;
  `;
  noBtn.addEventListener('click', () => resolve({ confirmed: false }));

  buttons.appendChild(yesBtn);
  buttons.appendChild(noBtn);
  container.appendChild(buttons);

  return container;
}

// ─── Input Dialog ─────────────────────────────────────────────────────────────

/**
 * Renderiza un dialog de input de texto.
 *
 * Muestra el title, un input con placeholder, y un botón "Enviar".
 */
export function renderInputDialog(
  request: ExtensionUIInputRequest,
  resolve: DialogResolve,
  reject: DialogReject,
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `
    border: 1px solid var(--color-border, #333);
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
    background: var(--color-surface, #1a1a1a);
  `;

  // Title
  const title = document.createElement('div');
  title.style.cssText = `font-weight: 600; margin-bottom: 12px; font-size: 14px;`;
  title.textContent = request.title;
  container.appendChild(title);

  // Input
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = request.placeholder || '';
  input.style.cssText = `
    width: 100%; padding: 8px 12px; border: 1px solid var(--color-border, #333);
    border-radius: 4px; background: var(--color-bg, #0a0a0a);
    color: var(--color-text, #e0e0e0); font-size: 14px;
    box-sizing: border-box;
  `;
  container.appendChild(input);

  // Buttons
  const buttons = document.createElement('div');
  buttons.style.cssText = `display: flex; gap: 8px; margin-top: 12px;`;

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Enviar';
  submitBtn.style.cssText = `
    padding: 8px 16px; border: none; border-radius: 4px;
    background: var(--color-accent, #4a9eff); color: var(--color-accent-fg, #fff);
    cursor: pointer; font-size: 14px;
  `;
  submitBtn.addEventListener('click', () => {
    const value = input.value.trim();
    if (value) resolve({ value });
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.style.cssText = `
    padding: 8px 16px; border: 1px solid var(--color-border, #333);
    border-radius: 4px; background: transparent; color: var(--color-text, #e0e0e0);
    cursor: pointer; font-size: 14px;
  `;
  cancelBtn.addEventListener('click', () => reject());

  buttons.appendChild(submitBtn);
  buttons.appendChild(cancelBtn);
  container.appendChild(buttons);

  // Enter para submit
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const value = input.value.trim();
      if (value) resolve({ value });
    }
  });

  // Auto-focus
  setTimeout(() => input.focus(), 50);

  return container;
}

// ─── Editor Dialog ────────────────────────────────────────────────────────────

/**
 * Renderiza un dialog de editor multiline.
 *
 * Muestra el title, un textarea con prefill, y un botón "Enviar".
 */
export function renderEditorDialog(
  request: ExtensionUIEditorRequest,
  resolve: DialogResolve,
  reject: DialogReject,
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `
    border: 1px solid var(--color-border, #333);
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
    background: var(--color-surface, #1a1a1a);
  `;

  // Title
  const title = document.createElement('div');
  title.style.cssText = `font-weight: 600; margin-bottom: 12px; font-size: 14px;`;
  title.textContent = request.title;
  container.appendChild(title);

  // Textarea
  const textarea = document.createElement('textarea');
  textarea.value = request.prefill || '';
  textarea.rows = 8;
  textarea.style.cssText = `
    width: 100%; padding: 8px 12px; border: 1px solid var(--color-border, #333);
    border-radius: 4px; background: var(--color-bg, #0a0a0a);
    color: var(--color-text, #e0e0e0); font-size: 14px;
    box-sizing: border-box; resize: vertical;
    font-family: monospace;
  `;
  container.appendChild(textarea);

  // Buttons
  const buttons = document.createElement('div');
  buttons.style.cssText = `display: flex; gap: 8px; margin-top: 12px;`;

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Enviar';
  submitBtn.style.cssText = `
    padding: 8px 16px; border: none; border-radius: 4px;
    background: var(--color-accent, #4a9eff); color: var(--color-accent-fg, #fff);
    cursor: pointer; font-size: 14px;
  `;
  submitBtn.addEventListener('click', () => resolve({ value: textarea.value }));

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.style.cssText = `
    padding: 8px 16px; border: 1px solid var(--color-border, #333);
    border-radius: 4px; background: transparent; color: var(--color-text, #e0e0e0);
    cursor: pointer; font-size: 14px;
  `;
  cancelBtn.addEventListener('click', () => reject());

  buttons.appendChild(submitBtn);
  buttons.appendChild(cancelBtn);
  container.appendChild(buttons);

  // Auto-focus
  setTimeout(() => textarea.focus(), 50);

  return container;
}
