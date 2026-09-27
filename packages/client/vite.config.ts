import { defineConfig } from 'vite';

const server = process.env['D2_SERVER'] ?? 'http://localhost:9090';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
      '/maps': server,
      '/api': server,
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
