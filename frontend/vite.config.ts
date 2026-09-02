import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The `/api` prefix exists only here. The Fastify API serves `/sources` and
// `/postings` unprefixed, so the rewrite strips it back off. Because every
// browser request is same-origin, the API needs no CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
