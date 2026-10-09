import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './server/app'

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    react(),
    {
      name: 'saleane-local-api',
      configureServer(server) {
        const api = createApiHandler({
          origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173',
          databasePath: process.env.DB_PATH,
          outboxIntervalMs: 30000,
        })
        server.middlewares.use((request, response, next) => {
          if (request.url?.startsWith('/api/')) void api(request, response, next)
          else next()
        })
        server.httpServer?.once('close', () => api.close())
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      deny: ['.env', '.env.*', '**/.git/**', '**/.saleane-data/**', '**/*.sqlite', '**/*.sqlite-*'],
    },
  },
  build: isSsrBuild
    ? {}
    : {
        rollupOptions: {
          input: {
            app: fileURLToPath(new URL('./index.html', import.meta.url)),
            studies: fileURLToPath(new URL('./design-studies/index.html', import.meta.url)),
          },
        },
      },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'lumane/**/*.test.ts'],
    setupFiles: './src/test/setup.ts',
    restoreMocks: true,
    // Whole-app journeys open several pages on demand; give them room on a busy machine.
    testTimeout: 20000,
  },
}))
