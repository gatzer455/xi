import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Vite config — Vanilla TypeScript, sin frameworks.
 *
 * Mismo patrón que apps/desktop/frontend/vite.config.ts: xi-ui se
 * consume vía alias (no hay npm workspaces en el repo).
 */

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

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
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  server: {
    port: 5174,
    host: true,
    strictPort: true,
    fs: {
      allow: [monorepoRoot],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
