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
 *
 * Usar para el render FINAL (texto completo). Para renders intermedios
 * de streaming usar `renderStreamingMarkdown`, que repara la sintaxis
 * a medio formar.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  return md.render(text);
}

// ─── Streaming: reparación de markdown incompleto ────────────────────
//
// El LLM emite markdown token a token, así que el tail del buffer suele
// tener sintaxis abierta (`**negr`, `` `cod ``, `$$x`, `[link](htt`...).
// Renderizar eso crudo muestra los caracteres de sintaxis un instante y
// luego "snapea" al formato final = flickering.
//
// Solución (renderizado optimista, igual que Gemini/Streamdown):
// completar la sintaxis abierta ANTES de parsear, para que el tail se
// muestre siempre en su estilo final y el texto crezca DENTRO del estilo.
//
//   - Inline (bold/italic/code/strikethrough/links): `remend`.
//   - Tablas y math de bloque `$$…$$`: no se pueden completar de forma
//     optimista (no hay con qué inventar el separador de tabla ni el
//     cuerpo de la fórmula). Se RETIENE el bloque a medio formar hasta
//     que cierre (buffering selectivo). Reaparece —y hace fade-in como
//     bloque nuevo— en cuanto está completo.

/** Separador de tabla GFM: `|---|`, `|:--:|`, etc. (requiere un `-`). */
const TABLE_SEPARATOR_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

/**
 * Si hay un bloque de math `$$…$$` sin cerrar, retiene desde su apertura
 * hasta el final (temml no puede renderizar LaTeX incompleto de forma
 * limpia). remend NO cierra `$$` (lo desactivamos) para no forzar esto.
 */
export function holdIncompleteMath(text: string): string {
  const count = (text.match(/\$\$/g) || []).length;
  if (count % 2 === 1) {
    return text.slice(0, text.lastIndexOf('$$'));
  }
  return text;
}

/**
 * Si el final del buffer es una tabla a medio formar (fila(s) con `|`
 * pero sin fila separadora todavía), devuelve el texto SIN ese bloque
 * para no mostrar pipes crudos. El texto retenido no se pierde: reaparece
 * en cuanto el separador llega y la tabla ya es renderizable.
 */
export function holdIncompleteTable(text: string): string {
  const lines = text.split('\n');

  // Run final de líneas que contienen `|`.
  let start = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('|')) start = i;
    else break;
  }
  if (start === lines.length) return text; // sin líneas de tabla al final

  const run = lines.slice(start);

  // Señal fuerte de fila de tabla: la cabecera tiene ≥2 pipes. Evita
  // retener prosa con un pipe suelto (ej: "usa `a | b`").
  const headerPipes = (run[0].match(/\|/g) || []).length;
  if (headerPipes < 2) return text;

  // Si ya hay una fila separadora, markdown-it renderiza la tabla → no retener.
  if (run.some((l) => TABLE_SEPARATOR_RE.test(l))) return text;

  // Retener el bloque de tabla incompleto.
  return lines.slice(0, start).join('\n');
}

/**
 * Delimitador de énfasis/código recién abierto al final del buffer, sin
 * contenido todavía (`**`, `***`, `~~`, `` ` ``, `*`, `_` precedido de
 * inicio o espacio). remend no puede cerrarlo (no hay contenido que
 * envolver), así que se mostraría crudo por un frame = flash. Lo quitamos;
 * reaparece bien formado en cuanto llega el contenido.
 */
const DANGLING_DELIM_RE = /(^|\s)(\*{1,3}|_{1,3}|~{1,2}|`)$/;

export function stripDanglingDelimiter(text: string): string {
  return text.replace(DANGLING_DELIM_RE, '$1');
}

/**
 * Link recién cerrado en corchetes pero sin `(url)` todavía (`[texto]` al
 * final del buffer). remend solo repara el corchete ABIERTO (`[texto` →
 * texto), pero deja `[texto]` literal, así que los corchetes aparecen un
 * frame y desaparecen cuando llega `(` = flash. Quitamos el `]` final para
 * que remend trate el link como en formación y muestre solo el texto.
 */
export function stripDanglingLinkClose(text: string): string {
  if (!text.endsWith(']')) return text;
  const open = text.lastIndexOf('[');
  if (open === -1) return text;
  const inner = text.slice(open + 1, -1);
  if (inner.includes('[') || inner.includes(']')) return text;
  return text.slice(0, -1);
}

/**
 * Render para frames INTERMEDIOS de streaming: repara el tail incompleto
 * antes de parsear, de modo que nunca se ve sintaxis cruda. El resultado
 * es prefix-stable frame a frame, lo que además evita re-animar texto ya
 * visible (ver reconcileDom).
 *
 * Observación: anteriormente se usaba remend para cerrar inline syntax
 * (**bold, *italic, `code) de forma optimista. Se eliminó por:
 *  - No maneja $$ (desactivado explícitamente)
 *  - Nuestras holds (holdIncompleteMath, holdIncompleteTable) + strips
 *    (stripDanglingDelimiter, stripDanglingLinkClose) cubren mejor los
 *    casos importantes sin dependencia extra.
 *  - El flash de 1 frame de **text crudo es casi invisible a 60fps.
 */
export function renderStreamingMarkdown(text: string): string {
  if (!text) return '';
  const held = stripDanglingLinkClose(
    stripDanglingDelimiter(holdIncompleteTable(holdIncompleteMath(text))),
  );
  if (!held) return '';
  return md.render(held);
}
