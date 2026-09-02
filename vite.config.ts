import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Seedwel Hub — Vite config.
// The dev server binds 0.0.0.0 so it can be previewed remotely, and proxies
// nothing: the browser talks to Supabase directly with the publishable key.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    // The PDF chunk (jsPDF + html2canvas) is big and stays big: it is what turns
    // an invoice into a branded A4 document and an 80 mm thermal receipt. It is
    // lazy, so it never costs a shopper anything.
    chunkSizeWarningLimit: 1500,
    // No manualChunks: every route is lazy (src/App.tsx), so Rollup already
    // splits jsPDF/html2canvas and recharts into chunks that only download when
    // a document or a chart is actually opened. Naming them here would force
    // them back into the initial graph, which is exactly what we do not want on
    // a phone.
  },
});
