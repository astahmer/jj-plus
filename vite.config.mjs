import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  root: resolve(process.cwd(), 'webview'),
  plugins: [solid()],
  server: {
    port: 4173,
  },
  build: {
    outDir: resolve(process.cwd(), 'webview-dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2020',
    rollupOptions: {
      input: resolve(process.cwd(), 'webview', 'index.html'),
      output: {
        entryFileNames: 'timeline-app.js',
        chunkFileNames: 'timeline-app.js',
        assetFileNames(assetInfo) {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'timeline-app.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
