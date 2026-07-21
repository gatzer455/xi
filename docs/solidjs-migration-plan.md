# Plan de migración a SolidJS

## Resumen ejecutivo

Migrar ~14,200 LOC (5.5K frontend + 5.5K xi-ui + 3.2K tests) de vanilla TypeScript a SolidJS.
Motivación: ergonomía (3x menos código), familiaridad para LLMs, y preparar el terreno para
tile-manager.

**Bundle:** +7KB (57KB vs ~50KB actual). Performance: misma (ambos son signals + DOM quirúrgico).

## Lo que se gana

| Aspecto | Vanilla TS (actual) | SolidJS |
|---------|---------------------|---------|
| Componente típico | 100-250 LOC manual DOM | 40-80 LOC JSX declarativo |
| Reactividad | `signal.ts` propio (45 LOC) | `createSignal` built-in |
| Stream markdown | SmoothStreamer + reconcileDom (~500 LOC) | `solid-markdown` reconcile mode o `@incremark/solid` |
| Testeo | `createElement` + queries manuales | `@solidjs/testing-library` (render, screen, fireEvent) |
| LLM familiarity | Baja (framework propio) | Alta (framework mainstream, documentado) |

## Lo que NO se gana (y está bien)

- **Performance**: ya estamos en el techo. SolidJS no es más rápido que vanilla signals + DOM directo.
- **Bundle size**: +7KB. Irrelevante para una app de escritorio.
- **Rust/WASM**: evaluado y descartado (ver issue #66). El puente JS↔WASM penaliza DOM frecuente.

---

## Scope: TODO se migra

| Categoría | Archivos | LOC | Estrategia |
|-----------|----------|-----|------------|
| **Pages** | chat, sessions, settings, welcome, explorer | ~3,100 | JSX components |
| **Components** | input, header, output, file-list, file-preview, chat-context-bar, chat-footer, model-picker, update-banner | ~1,700 | JSX components |
| **xi-ui components** | chat-bubble, chat-messages, slash-menu, chips, chip-groups, extension-ui-dialog | ~1,200 | JSX components |
| **Pipeline streaming** | smooth-streamer, markdown, chat-bubble (reconcileDom) | ~800 | Reemplazar con `solid-markdown` (reconcile mode) o `@incremark/solid` |
| **State/Reactividad** | signal.ts, scope.ts, state.ts | ~350 | `createSignal` + `createRoot` + `onCleanup` |
| **Lib (sin DOM)** | transport, event-parser, state-sync, types, tauri-commands, slash-commands, format-tool-call, icons | ~1,400 | Sin cambios (solo quitar types de DOM) |
| **CSS** | tokens, theme, components, markdown, layout, pages, base | ~1,500 | Sin cambios |
| **Tests** | todos | ~3,200 | Reescribir con `@solidjs/testing-library` |
| **Config** | vite.config, tsconfig, package.json | ~50 | Agregar `vite-plugin-solid`, `solid-js` |

---

## Dependencias nuevas

```json
{
  "dependencies": {
    "solid-js": "^1.9.0",
    "solid-markdown": "^2.0.0"
  },
  "devDependencies": {
    "vite-plugin-solid": "^2.11.0",
    "@solidjs/testing-library": "^0.8.0"
  }
}
```

**Dependencias que se eliminan:**
- `markdown-it` + `markdown-it-math` (reemplazado por `solid-markdown` con remark plugins)
- `temml` (opcional: solid-markdown usa KaTeX; evaluar si temml es necesario)

---

## Pipeline de streaming: de SmoothStreamer a solid-markdown

### Actual (vanilla)

```
pi stdout → state-sync (throttle 50ms)
          → SmoothStreamer (buffer + rAF)
          → markdown-it (render completo cada frame)
          → reconcileDom (DOM diff, fade-in)
          → chat-bubble (innerHTML via appendChild)
```

### Propuesto (SolidJS)

```
pi stdout → state-sync (throttle 50ms)  ← SIN CAMBIOS
          → createSignal(content)        ← señal reactiva de SolidJS
          → <SolidMarkdown
              renderingStrategy="reconcile"
              children={content()}
            />
```

**`solid-markdown` con `reconcile` mode:**
- Hace diff del AST de markdown (no del DOM)
- Solo re-renderiza los nodos del AST que cambiaron
- Los bloques previos mantienen identidad estable (sin flicker)
- Animaciones CSS propias en nuevos bloques

**Alternativa más avanzada: `@incremark/solid`**
- Streaming nativo: recibe chunks, no necesita buffer completo
- Manejo de sintaxis incompleta mid-stream
- Fade-in, typewriter, cursor CSS
- ~2KB gzipped

**Recomendación:** Empezar con `solid-markdown` (más simple, reemplazo directo).
Evaluar `@incremark/solid` en PR futuro si hace falta typewriter.

### Qué desaparece

| Archivo | LOC | Reemplazado por |
|---------|-----|-----------------|
| `smooth-streamer.ts` | 252 | `solid-markdown` reconcile mode |
| `markdown.ts` | 245 | `solid-markdown` |
| `reconcileDom()` en chat-bubble.ts | ~80 | `solid-markdown` reconcile interno |
| `chat-messages.ts` | 129 | `solid-markdown` componente |

**Total eliminado:** ~700 LOC. **Total nuevo:** ~30 LOC (wrapper component).

---

## Signals: de signal.ts a createSignal

### Actual

```typescript
// signal.ts (~45 LOC)
export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<(val: T) => void>();
  return {
    get value() { return value; },
    set value(v: T) {
      if (v !== value) { value = v; listeners.forEach(fn => fn(v)); }
    },
    subscribe(fn: (val: T) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
```

### SolidJS

```typescript
import { createSignal, createEffect, onCleanup } from 'solid-js';

// En vez de signal.value / signal.value = x:
const [value, setValue] = createSignal<T>(initial);

// En vez de subscribe:
createEffect(() => {
  console.log(value()); // se re-ejecuta cuando value cambia
});

// En vez de scope.add(fn):
onCleanup(() => { /* cleanup */ });
```

### Mapeo de conceptos

| Vanilla | SolidJS |
|---------|---------|
| `signal(initial)` | `createSignal(initial)` → `[accessor, setter]` |
| `sig.value` (get) | `accessor()` |
| `sig.value = x` (set) | `setter(x)` |
| `sig.subscribe(fn)` | `createEffect(() => { fn(accessor()) })` |
| `scope.add(fn)` | `onCleanup(fn)` |
| `scope.dispose()` | Automático (component unmount) |
| `createScope()` | `createRoot()` (para raíces non-JSX) |

### Signal global (appState)

`state.ts` (~260 LOC) expone señales globales como `appState.currentSessionId`, `appState.isStreaming`, etc.

**Plan:** Convertir `appState` a un store de SolidJS con `createMutable` o una colección de `createSignal` exportados. SolidJS permite señales a nivel módulo sin componentes.

```typescript
// state.ts post-migración
import { createSignal } from 'solid-js';

export const [currentSessionId, setCurrentSessionId] = createSignal<string | null>(null);
export const [isStreaming, setIsStreaming] = createSignal(false);
export const [explorerPanelOpen, setExplorerPanelOpen] = createSignal(false);
// ... etc
```

---

## Componentes: patrón de migración

### Before (vanilla)

```typescript
// slash-menu.ts (~156 LOC)
export function SlashMenu(onSelect: (cmd: Command) => void) {
  const el = document.createElement('div');
  el.className = 'slash-menu';
  // ... querySelectorAll, classList.toggle, scroll manual ...

  function update(query: string) {
    el.innerHTML = '';
    // filter commands, create elements, append...
  }

  return { el, update, close, moveUp, moveDown, selectHighlighted };
}
```

### After (SolidJS)

```tsx
// slash-menu.tsx (~47 LOC)
export function SlashMenu(props: { commands: Command[]; onSelect: (cmd: Command) => void }) {
  const [query, setQuery] = createSignal('');
  const filtered = () => props.commands.filter(c => c.name.includes(query()));

  return (
    <div class="slash-menu">
      <For each={filtered()}>
        {(cmd) => (
          <button class="slash-item" onClick={() => props.onSelect(cmd)}>
            <span class="slash-keyword">{cmd.keyword}</span>
            <span class="slash-desc">{cmd.description}</span>
          </button>
        )}
      </For>
    </div>
  );
}
```

---

## Plan de ejecución (PR por PR)

### PR 1: Setup e infraestructura
- Instalar `solid-js`, `vite-plugin-solid`, `@solidjs/testing-library`
- Configurar `vite.config.ts` (agregar `solidPlugin()`)
- Configurar `tsconfig.json` (`"jsx": "preserve"`, `"jsxImportSource": "solid-js"`)
- Configurar `vitest` para SolidJS (`environment: 'jsdom'`, `transformMode`, `resolve.conditions`)
- Migrar `signal.ts` → re-export desde `solid-js`
- Migrar `scope.ts` → re-export `createRoot`, `onCleanup`
- Migrar `state.ts` → `createSignal`s globales
- **Resultado:** Tests existentes siguen pasando con las nuevas señales (compatibles hacia atrás)

### PR 2: Componentes hoja (sin estado complejo)
- `icons.ts` → `Icon` component JSX (reemplaza `icon()` factory)
- `slash-menu.ts` → `SlashMenu.tsx` (47 LOC, -109 LOC)
- `chips.ts` → `Chip.tsx`
- `chip-groups.ts` → `ChipGroup.tsx`
- `chat-footer.ts` → `ChatFooter.tsx`
- `update-banner.ts` → `UpdateBanner.tsx`
- **Resultado:** ~400 LOC menos, tests actualizados

### PR 3: Pipeline de streaming (el corazón)
- Migrar `chat-bubble.ts` → `ChatBubble.tsx` con `solid-markdown`
- Eliminar `smooth-streamer.ts`, `markdown.ts`, `chat-messages.ts`
- `state-sync.ts` ahora escribe a un `createSignal(content)` en vez de llamar a `SmoothStreamer.feed()`
- **Resultado:** ~700 LOC eliminados, ~100 LOC nuevos, streaming funciona con reconcile nativo de SolidJS

### PR 4: Shell y páginas
- `header.ts` → `Header.tsx`
- `input.ts` → `InputBar.tsx` (slash commands integrados)
- `output.ts` → `OutputBoard.tsx` (router de páginas)
- `main.ts` → `App.tsx` (entry point JSX)
- `chat.ts` → `ChatPage.tsx`
- `sessions.ts` → `SessionsPage.tsx`
- `settings.ts` → `SettingsPage.tsx`
- `welcome.ts` → `WelcomePage.tsx`
- `explorer.ts` + `file-list.ts` + `file-preview.ts` → componentes JSX
- **Resultado:** Layout completo en SolidJS, routing con `<Show>`/`<Switch>`

### PR 5: Diálogos y extensiones
- `extension-ui-dialog.ts` → `ExtensionDialog.tsx`
- `model-picker.ts` → `ModelPicker.tsx`
- `chat-context-bar.ts` → `ChatContextBar.tsx`
- Integrar bubble button como componente JSX dentro del layout

### PR 6: Tests
- Migrar todos los tests a `@solidjs/testing-library`
- Mocks de señales → `createSignal` para tests
- Mocks de Tauri commands → igual que ahora

### PR 7: Limpieza final
- Eliminar `signal.ts`, `scope.ts` (re-export de SolidJS basta)
- Eliminar dependencias obsoletas (`markdown-it`, `markdown-it-math`)
- Actualizar CLAUDE.md, tsconfig, etc.
- Verificar bundle size final

---

## Riesgos y mitigaciones

| Riesgo | Prob | Impacto | Mitigación |
|--------|------|---------|------------|
| `solid-markdown` no rinde como `reconcileDom` | Media | Alto | PR 3 es el más crítico. Hacer benchmark antes de mergear: comparar frames perdidos, flicker visual |
| Tests rotos masivamente | Alta | Medio | `@solidjs/testing-library` tiene API similar a nuestro testing actual. Sobrecarga: ~20% más LOC en tests |
| Doble runtime (vanilla + SolidJS) durante migración | Alta | Bajo | Conviven sin problema. SolidJS no interfiere con DOM manual. Migración incremental sin regresiones |
| Curva de aprendizaje para el equipo | Media | Bajo | Solo yo (nego) toco el código. La familiaridad para LLMs futuros es ganancia neta |
| `@incremark/solid` o `solid-markdown` no soportan temml (LaTeX) | Media | Medio | Verificar en PR 3. Ambos soportan KaTeX. Si temml es crítico, mantener `markdown-it` con temml y wrapper SolidJS |

---

## Lo que NO cambia

- **Backend Rust**: Cero cambios.
- **Tauri IPC**: `invoke()` / `listen()` siguen igual. SolidJS no interviene en la capa de transporte.
- **PiEventBus**: La abstracción de transporte no se toca.
- **CSS**: Los estilos son agnósticos de framework.
- **xi-serve**: Cero cambios. El mobile frontend se migrará en PR separado (misma estrategia).
- **Extensiones (xi-tools, xi-exa, xi-flow)**: Cero cambios. Viven en `ExtensionAPI`, no en el DOM.

---

## Referencias

- [solid-markdown](https://github.com/andi23rosca/solid-markdown) — Markdown renderer con reconcile mode
- [solid-streamdown](https://github.com/vherbruck/solid-streamdown) — Streaming markdown para SolidJS
- [@incremark/solid](https://www.npmjs.com/package/@incremark/solid) — Streaming markdown con typewriter
- [vite-plugin-solid](https://github.com/solidjs/vite-plugin-solid) — Plugin oficial de Vite
- [@solidjs/testing-library](https://github.com/solidjs/solid-testing-library) — Testing para SolidJS
- [SolidJS + Vitest docs](https://docs.solidjs.com/guides/testing) — Guía oficial de testing
