import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const BOT_PORT = process.env['BOT_PORT'] ?? 3001;

export default defineConfig({
  plugins: [preact()],
  root: './dashboard',
  build: {
    outDir: './dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: `http://localhost:${BOT_PORT}`, changeOrigin: true },
      '/events': { target: `http://localhost:${BOT_PORT}`, changeOrigin: true },
    },
  },
});
