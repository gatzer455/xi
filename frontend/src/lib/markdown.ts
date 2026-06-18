/**
 * markdown.ts — Wrapper sobre markdown-it con tema pi-light.
 *
 * Configuración:
 * - `html: false` previene XSS (no permite HTML inline).
 * - `linkify: true` autolinks URLs.
 * - `typographer: false` (sin smart quotes — mantener simple).
 *
 * Syntax highlighting con highlight.js core + 9 lenguajes comunes
 * (bash, ts, js, json, rust, python, html, css, markdown).
 *
 * Output: HTML strings con CSS classes que matchean `markdown.css`
 * (md-h1, md-code, md-code-block, etc.). El caller (chat-bubble.ts)
 * inyecta con `innerHTML` en un container.
 *
 * Inspirado en `getMarkdownTheme()` de pi TUI:
 *   ~/.nvm/.../pi-coding-agent/dist/modes/interactive/theme/theme.js:971
 */

import MarkdownIt from 'markdown-it';
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
