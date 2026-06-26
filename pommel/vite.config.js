import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 8000,
    host: true,
    allowedHosts: ["brute.chestnut-in.ts.net"],
  },
})
