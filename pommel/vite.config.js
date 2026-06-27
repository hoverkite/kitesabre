import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

function telemetryJsonlPlugin() {
  const logDir = path.resolve(process.cwd(), 'logs')
  const logPath = path.join(logDir, 'telemetry.jsonl')

  return {
    name: 'telemetry-jsonl-endpoint',
    configureServer(server) {
      fs.mkdirSync(logDir, { recursive: true })

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/telemetry')) {
          next()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let body = ''
        req.setEncoding('utf8')

        req.on('data', (chunk) => {
          body += chunk
          if (body.length > 2_000_000) {
            res.statusCode = 413
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Payload too large' }))
            req.destroy()
          }
        })

        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}')
            const events = Array.isArray(parsed.events) ? parsed.events : [parsed]
            const receivedAt = new Date().toISOString()
            const remoteAddress = req.socket?.remoteAddress ?? null

            const lines = events
              .filter((event) => event && typeof event === 'object')
              .map((event) => JSON.stringify({ receivedAt, remoteAddress, ...event }))
              .join('\n')

            if (lines.length > 0) {
              fs.appendFileSync(logPath, `${lines}\n`, 'utf8')
            }

            res.statusCode = 204
            res.end()
          } catch (error) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid JSON', message: String(error) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [telemetryJsonlPlugin()],
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
