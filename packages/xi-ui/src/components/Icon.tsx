/**
 * Icon.tsx — Componente SolidJS para iconos SVG inline.
 *
 * Envuelve la factory icon() de icons.ts para uso en JSX.
 * Import:
 *   import { Icon } from 'xi-ui/components/Icon.tsx';
 *   <Icon name="folder" size={20} />
 *
 * Para código vanilla, seguir usando icon() de xi-ui/lib/icons.ts.
 */

import { icon as iconFactory } from '../lib/icons.ts';
import { createMemo, type JSX } from 'solid-js';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  class?: string;
}

export function Icon(props: IconProps): JSX.Element {
  // Crear el SVGElement una sola vez (es estático)
  const svg = iconFactory(props.name, {
    size: props.size,
    color: props.color,
    strokeWidth: props.strokeWidth,
  });

  if (props.class) svg.classList.add(...props.class.split(' '));

  return svg as unknown as JSX.Element;
}
