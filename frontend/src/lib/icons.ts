/**
 * icons.ts — Helper para renderizar iconos Lucide como SVG inline
 *
 * Lucide Icons: https://lucide.dev
 * Licencia: ISC (equivalente a MIT)
 *
 * Los iconos de Lucide son arrays anidados: [['path', {d: '...'}], ['circle', {...}]]
 * que convertimos a SVG elements.
 *
 * Uso:
 *   import { icon } from '../lib/icons.ts';
 *   element.append(icon('folder'));
 *   element.append(icon('file', { size: 16 }));
 */

import {
  Folder,
  FolderOpen,
  FolderTree,
  File,
  FileText,
  FileCode,
  FileJson,
  Settings,
  ChevronRight,
  ChevronDown,
  MessageSquarePlus,
  Pencil,
} from 'lucide';

// Tipo para los nodos de icono Lucide: [tag, attrs] o [['tag', attrs], ...]
type IconNodeChild = [string, Record<string, string | number>];
type IconNode = IconNodeChild[];

// Mapa de nombres a iconos Lucide
const iconMap: Record<string, IconNode> = {
  folder: Folder as unknown as IconNode,
  'folder-open': FolderOpen as unknown as IconNode,
  'folder-tree': FolderTree as unknown as IconNode,
  'message-square-plus': MessageSquarePlus as unknown as IconNode,
  file: File as unknown as IconNode,
  'file-text': FileText as unknown as IconNode,
  'file-code': FileCode as unknown as IconNode,
  'file-json': FileJson as unknown as IconNode,
  settings: Settings as unknown as IconNode,
  'chevron-right': ChevronRight as unknown as IconNode,
  'chevron-down': ChevronDown as unknown as IconNode,
  pencil: Pencil as unknown as IconNode,
};

interface IconOptions {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Crea un elemento SVG desde un IconNode de Lucide
 */
function createSvgFromIconNode(
  iconNode: IconNode,
  size: number,
  color: string,
  strokeWidth: number
): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color);
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  // Cada elemento del array es [tagName, attrs]
  for (const element of iconNode) {
    const [tagName, attrs] = element;
    const el = document.createElementNS('http://www.w3.org/2000/svg', tagName);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, String(value));
    }
    svg.append(el);
  }

  return svg;
}

/**
 * Crea un elemento SVG con un icono Lucide
 * @param name - Nombre del icono (ej: 'folder', 'file', 'settings')
 * @param options - Opciones de estilo
 * @returns Elemento SVG
 */
export function icon(name: string, options: IconOptions = {}): SVGElement {
  const {
    size = 16,
    color = 'currentColor',
    strokeWidth = 1.5,
  } = options;

  const iconNode = iconMap[name];
  if (!iconNode) {
    console.warn(`Icon "${name}" not found in iconMap`);
    // Fallback: punto simple
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', color);
    svg.setAttribute('stroke-width', String(strokeWidth));
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '2');
    svg.append(circle);
    return svg;
  }

  return createSvgFromIconNode(iconNode, size, color, strokeWidth);
}

/**
 * Determina el icono apropiado para un archivo
 * @param isDir - Si es un directorio
 * @param name - Nombre del archivo
 * @returns Nombre del icono Lucide
 */
export function getFileIconName(isDir: boolean, name: string): string {
  if (isDir) return 'folder';

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const extMap: Record<string, string> = {
    md: 'file-text',
    txt: 'file-text',
    json: 'file-json',
    ts: 'file-code',
    js: 'file-code',
    jsx: 'file-code',
    tsx: 'file-code',
    rs: 'file-code',
    py: 'file-code',
    go: 'file-code',
    html: 'file-code',
    css: 'file-code',
  };

  return extMap[ext] ?? 'file';
}
