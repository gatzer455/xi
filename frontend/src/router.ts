/**
 * router.ts — Capa 3 (Routing)
 *
 * Hash-based client-side router. Usamos hash (#/chat, #/settings)
 * en vez de History API porque:
 *
 * 1. Funciona sin servidor: el hash nunca se envía al servidor.
 * 2. Funciona offline: cambios de hash no requieren red.
 * 3. Simplicidad: ~80 líneas. Sin dependencias.
 *
 * Copiado de musicologo, adaptado para xi.
 */

import { appState } from './lib/state.ts';

type PageFn = () => HTMLElement;

const routes = new Map<string, PageFn>();
let outlet: HTMLElement;
let sidebar: HTMLElement | null = null;

/**
 * Registrar una ruta.
 */
export function route(pattern: string, page: PageFn): void {
  routes.set(pattern, page);
}

/**
 * Navegar a una ruta.
 */
export function navigate(hash: string): void {
  location.hash = hash;
}

/**
 * Inicializar el router. Se llama UNA vez al arrancar la app.
 */
export function initRouter(outletId: string, sidebarId?: string): void {
  outlet = document.getElementById(outletId)!;
  if (sidebarId) {
    sidebar = document.getElementById(sidebarId);
  }

  window.addEventListener('hashchange', renderRoute);

  if (!location.hash) {
    // Default: welcome. xi es opinionated — sin workingDir no se puede
    // usar el chat, y la welcome es lo que ve un usuario nuevo.
    location.hash = '#/welcome';
  } else {
    renderRoute();
  }
}

/**
 * Destruir la página actual y renderizar la nueva.
 */
function renderRoute(): void {
  const hash = location.hash || '#/welcome';
  const pageFn = routes.get(hash);

  if (!pageFn) {
    outlet.replaceChildren(NotFoundPage());
    return;
  }

  // Defense in depth: si el usuario llega a #/chat sin workingDir
  // (URL pegada, link externo, etc.), redirigir a #/welcome. El flujo
  // normal no debería llegar acá — main.ts setea el hash correcto
  // según el estado.
  if (hash === '#/chat' && !appState.workingDir.value) {
    location.hash = '#/welcome';
    return;
  }

  const page = pageFn();
  outlet.replaceChildren(page);

  // Ocultar la sidebar en la welcome. Es la pantalla completa,
  // sin distracciones. En las otras rutas la sidebar vuelve a
  // aparecer.
  if (sidebar) {
    sidebar.style.display = hash === '#/welcome' ? 'none' : 'flex';
  }
}

/**
 * Página 404.
 */
function NotFoundPage(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'not-found';

  const h1 = document.createElement('h1');
  h1.textContent = '404';
  div.append(h1);

  const p = document.createElement('p');
  p.textContent = 'Esta página no existe.';
  div.append(p);

  const a = document.createElement('a');
  a.href = '#/chat';
  a.textContent = 'Volver al chat';
  div.append(a);

  return div;
}
