/**
 * markdown.ts — Wrapper sobre markdown-it con tema pi-light.
 *
 * Qué hace:
 * - Renderiza markdown a HTML con syntax highlighting (highlight.js).
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
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import rust from 'highlight.js/lib/languages/rust';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';     // html
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);               // alias
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);                // alias
hljs.registerLanguage('json', json);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);                     // alias
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);                   // alias
hljs.registerLanguage('html', xml);                    // alias
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);                 // alias

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
}).use(markdownItMath, {
  temmlOptions: { macros: {} },
});

// ─────────────────────────────────────────────────────────────────
// Custom renderers — agregan clases .md-* a cada tipo de token.
// markdown-it renderiza tokens en secuencia; cada regla recibe
// el token actual y debe devolver el HTML para ese token.
// ─────────────────────────────────────────────────────────────────

type Token = any;

/**
 * Crea un renderer que agrega una clase CSS fija al tag de apertura.
 *
 * markdown-it separa cada tag en dos tokens (open/closing).
 * nesting=1 → tag de apertura (<div>), nesting=-1 → cierre (</div>).
 * Solo agregamos la clase al abrir; cerrar no necesita atributos.
 */
function addClass(cls: string): (t: Token[], i: number, o: any, e: any, s: any) => string {
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
md.renderer.rules.hr                = addClass('md-hr');

// ── Inline formatting
md.renderer.rules.strong_open = addClass('md-strong');
md.renderer.rules.em_open     = addClass('md-em');
md.renderer.rules.s_open      = addClass('md-del');
md.renderer.rules.code_inline = addClass('md-code');

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

// Configuración de highlight.js (después de crear md).
Object.assign(md.options, {
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="md-code-block hljs"><code class="hljs language-${lang}">${highlighted}</code></pre>`;
      } catch {
        // Fall through a escapeHtml
      }
    }
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
