import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`     → dist/      (host on Vercel / Netlify, talks to Apps Script over HTTPS)
// `npm run build:gas` → dist-gas/  (one self-contained index.html to paste into Apps Script as "Index")
// `npm run test:e2e`  → dist-e2e/  (built against the local emulator, see playwright.config.js)
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'gas' ? [viteSingleFile()] : [])],
  build: mode === 'gas'
    ? { outDir: 'dist-gas', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 2000 }
    : { outDir: mode === 'e2e' ? 'dist-e2e' : 'dist', chunkSizeWarningLimit: 600 },
  server: { host: true },
  test: { include: ['tests/**/*.test.js'] },   // unit/backend tests (vitest); e2e/ is run by Playwright
}));
