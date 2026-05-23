import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['lucide-react', 'react-hot-toast', 'clsx'],
          'markdown-vendor': ['react-markdown', 'remark-gfm', 'rehype-highlight'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
})
