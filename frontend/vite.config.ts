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
    // Target moderno para soportar top-level await (temml).
    target: 'es2022',
  },
  // esbuild target para dev server (top-level await).
  esbuild: {
    target: 'es2022',
  },
  // Optimización de dependencias: esbuild target para dev server.
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
