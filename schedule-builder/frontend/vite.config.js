import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local-only dev server. API calls to /api are proxied to the Express backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': 'http://localhost:5175',
    },
  },
});
