/**
 * markdown.ts — Wrapper sobre markdown-it con tema pi-light.
 *
 * Qué hace:
 * - Renderiza markdown a HTML (sin syntax highlighting — se usa escapeHtml).
 * - Agrega clases .md-* a cada elemento para que markdown.css pueda
 *   estilarlos por clase en vez de por tag (más portable).
 *
 * Por qué clases en vez de selectores por tag:
 *   Si el CSS usara `.message-text h1`, quedaría acoplado al nombre
 *   del contenedor. Con `.md-h1` el HTML ya trae la clase y funciona
 *   en cualquier contexto (chat, tool results, etc.).
 *
 * Inspirado en `getMarkdownTheme()` de pi TUI:
 *   ~/.nvm/.../pi-coding-agent/dist/modes/interactive/theme/theme.js:971
 */

import MarkdownIt from 'markdown-it';
import markdownItMath from 'markdown-it-math/temml';

// Tipos mínimos de markdown-it (solo los campos que usamos).
// @types/markdown-it v14 + tsgo no permiten extraer Token/Renderer
// como miembros nombrados del import default.
interface Token {
  nesting: number;
  attrPush(attr: [string, string]): void;
  attrJoin(name: string, value: string): void;
}
interface Renderer {
  renderToken(tokens: Token[], idx: number, options: unknown): string;
}
type RenderRule = (tokens: Token[], idx: number, options: unknown, env: unknown, self: Renderer) => string;

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
}).use(markdownItMath, {
  // throwOnError: false → si llega LaTeX inválido (típico en streaming,
  // ej. `$$x^$$` a medio escribir) temml emite un nodo de error en vez
  // de tirar una excepción que rompería todo el render.
  temmlOptions: { macros: {}, throwOnError: false },
});

// ─────────────────────────────────────────────────────────────────
// Custom renderers — agregan clases .md-* a cada tipo de token.
// markdown-it renderiza tokens en secuencia; cada regla recibe
// el token actual y debe devolver el HTML para ese token.
// ─────────────────────────────────────────────────────────────────

/**
 * Crea un renderer que agrega una clase CSS fija al tag de apertura.
 *
 * markdown-it separa cada tag en dos tokens (open/closing).
 * nesting=1 → tag de apertura (<div>), nesting=-1 → cierre (</div>).
 * Solo agregamos la clase al abrir; cerrar no necesita atributos.
 */
function addClass(cls: string): RenderRule {
  return (tokens, idx, _options, _env, self) => {
    const token = tokens[idx];
    if (token.nesting === 1) {
      token.attrPush(['class', cls]);
    }
    return self.renderToken(tokens, idx, _options);
  };
}

// ── Headings: la clase depende del nivel (h1→md-h1, h2→md-h2, etc.)
md.renderer.rules.heading_open = (tokens, idx, _options, _env, self) => {
  tokens[idx].attrPush(['class', `md-${tokens[idx].tag}`]);
  return self.renderToken(tokens, idx, _options);
};

// ── Block elements
md.renderer.rules.paragraph_open    = addClass('md-p');
md.renderer.rules.bullet_list_open  = addClass('md-list');
md.renderer.rules.ordered_list_open = addClass('md-ol');
md.renderer.rules.list_item_open    = addClass('md-li');
md.renderer.rules.blockquote_open   = addClass('md-quote');
// hr es self-closing (nesting=0): addClass no aplica. Usamos
// renderToken directo (hr no tiene default rule en markdown-it v14+).
md.renderer.rules.hr = (tokens, idx, options, env, self) => {
  tokens[idx].attrPush(['class', 'md-hr']);
  return self.renderToken(tokens, idx, options);
};

// ── Inline formatting
md.renderer.rules.strong_open = addClass('md-strong');
md.renderer.rules.em_open     = addClass('md-em');
md.renderer.rules.s_open      = addClass('md-del');

// ── code_inline: self-closing (nesting=0) — `addClass` no aplica porque
// solo agrega clase si nesting===1. Hay que envolver el default rule
// (patrón oficial de la doc, igual que link_open). Sin esto, `self.renderToken`
// solo emite `<code>` sin contenido ni cierre, y el HTML queda roto:
// <li>Usa <code> para debuggear</li>
// y los <code> huérfanos hacen que el browser cierre mal los tags
// siguientes, achicando el texto progresivamente. Ver:
//   https://github.com/markdown-it/markdown-it/issues/1068
const defaultCodeInline = md.renderer.rules.code_inline!;
md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
  tokens[idx].attrPush(['class', 'md-code']);
  return defaultCodeInline(tokens, idx, options, env, self);
};

// ── Links: el <a> lleva clase, el href se mantiene
md.renderer.rules.link_open = (tokens, idx, _options, _env, self) => {
  tokens[idx].attrPush(['class', 'md-link']);
  return self.renderToken(tokens, idx, _options);
};

// ── Tables: tabla, thead, tbody, filas, celdas
md.renderer.rules.table_open = addClass('md-table');
md.renderer.rules.thead_open = addClass('md-thead');
md.renderer.rules.tbody_open = addClass('md-tbody');
md.renderer.rules.tr_open    = addClass('md-tr');
md.renderer.rules.th_open    = addClass('md-th');
md.renderer.rules.td_open    = addClass('md-td');

// Configuración de syntax highlighting: escapeHtml (sin hljs).
Object.assign(md.options, {
  highlight(code: string, _lang: string): string {
    return `<pre class="md-code-block"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

/**
 * Renderiza texto markdown a HTML. Para inyectar con `innerHTML`.
 * El caller es responsable de pasar el output por un DOM seguro
 * (no user input no sanitizado — aunque html:false ya mitiga).
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  return md.render(text);
}
