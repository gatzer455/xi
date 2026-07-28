import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'XiTerminal',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    rollupOptions: {
      external: [],
    },
    minify: false,
  },
});
