import { defineConfig } from 'vite';

/**
 * Vite config — Vanilla TypeScript, sin frameworks.
 *
 * En desarrollo: dev server con HMR en localhost:5173.
 * En producción: `vite build` genera bundle optimizado en dist/.
 *
 * Tauri carga el dev server en desarrollo y los assets estáticos en producción.
 */

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
});
