import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Local Vite plugin that intercepts POST /api/parse-rule during `npm run dev`
 * and runs the serverless function handler server-side with GEMINI_API_KEY.
 */
function localApiPlugin() {
  return {
    name: 'local-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/parse-rule' && req.method === 'POST') {
          try {
            let bodyStr = ''
            for await (const chunk of req) {
              bodyStr += chunk
            }

            let body = {}
            if (bodyStr) {
              try {
                body = JSON.parse(bodyStr)
              } catch {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                return res.end(JSON.stringify({ error: 'Invalid JSON request body' }))
              }
            }

            const mockReq = {
              method: 'POST',
              body,
              headers: req.headers,
            }

            const mockRes = {
              statusCode: 200,
              setHeader(key, value) {
                res.setHeader(key, value)
              },
              status(code) {
                this.statusCode = code
                res.statusCode = code
                return this
              },
              json(payload) {
                res.setHeader('Content-Type', 'application/json')
                res.statusCode = this.statusCode
                res.end(JSON.stringify(payload))
              },
            }

            const { default: handler } = await server.ssrLoadModule('/api/parse-rule.js')
            await handler(mockReq, mockRes)
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message || 'Internal server error in local API proxy' }))
          }
        } else {
          next()
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load environment variables server-side into process.env without prefixing with VITE_
  const env = loadEnv(mode, process.cwd(), '')
  if (env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY
  }
  if (env.GEMINI_MODEL) {
    process.env.GEMINI_MODEL = env.GEMINI_MODEL
  }

  return {
    plugins: [react(), localApiPlugin()],
  }
})
