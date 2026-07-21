import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import solidPlugin from 'vite-plugin-solid';

/**
 * Vite config — Vanilla TypeScript + SolidJS.
 *
 * En desarrollo: dev server con HMR en localhost:5173.
 * En producción: `vite build` genera bundle optimizado en dist/.
 *
 * Tauri carga el dev server en desarrollo y los assets estáticos en producción.
 */

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

// packages/xi-ui es código fuente compartido (sin package.json ni build propio,
// misma convención que xi-exa/xi-flow) — se consume vía alias, no vía npm workspace.
const xiUiSrc = fileURLToPath(new URL('../../../packages/xi-ui/src', import.meta.url));
const monorepoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export default defineConfig({
  root: '.',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      'xi-ui': xiUiSrc,
    },
  },
  plugins: [solidPlugin()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  optimizeDeps: {
    include: ['katex'],
    esbuildOptions: {
      target: 'es2022',
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    fs: {
      // packages/xi-ui vive fuera del root de este proyecto Vite.
      allow: [monorepoRoot],
    },
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
