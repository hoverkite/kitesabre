import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: process.env.GITHUB_ACTIONS ? '/kitesabre/' : '/',
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
