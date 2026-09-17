import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // Verification harnesses (docs/TESTING.md) start an isolated backend on another port and
    // need `npm run build && npx vite preview` to proxy to it; BACKEND_PORT overrides the
    // ordinary local-dev default so nothing else that relies on 8085 has to change.
    proxy: {
      '/api': `http://127.0.0.1:${process.env.BACKEND_PORT || 8085}`
    }
  },
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
