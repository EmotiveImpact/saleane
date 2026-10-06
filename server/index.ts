import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createReadStream, lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './app'
import type { ApiHandler } from './app'

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Resolve existing symlink parents even when the final database or build does not exist yet. */
function prospectiveRealpath(path: string, depth = 0): string {
  if (depth > 40) throw new Error('A filesystem path contains too many symbolic links.')
  let ancestor = resolve(path)
  const missing: string[] = []
  for (;;) {
    try {
      return resolve(realpathSync(ancestor), ...missing)
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      try {
        if (lstatSync(ancestor).isSymbolicLink())
          return resolve(
            prospectiveRealpath(resolve(dirname(ancestor), readlinkSync(ancestor)), depth + 1),
            ...missing,
          )
      } catch (linkError) {
        if (!['ENOENT', 'ENOTDIR'].includes((linkError as NodeJS.ErrnoException).code ?? ''))
          throw linkError
      }
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      missing.unshift(basename(ancestor))
      ancestor = parent
    }
  }
}

function protectDatabase(staticRoot: string, databasePath?: string) {
  if (databasePath === ':memory:') return
  const database = resolve(databasePath ?? '.saleane-data/saleane.sqlite')
  const canonicalRoot = prospectiveRealpath(staticRoot)
  const inside = (file: string, root: string) => {
    // Reject conservatively on platforms where prospective path case can alias.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      file = file.toLowerCase()
      root = root.toLowerCase()
    }
    return file === root || file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const file = database + suffix
    if (inside(file, staticRoot) || inside(prospectiveRealpath(file), canonicalRoot))
      throw new Error(
        'DB_PATH and its SQLite companions must be outside STATIC_ROOT. The local database is never served as a static file.',
      )
  }
}

export function createLocalServer(options: {
  origin: string
  databasePath?: string
  staticRoot?: string
}): { server: Server; api: ApiHandler } {
  const root = resolve(options.staticRoot ?? 'dist')
  protectDatabase(root, options.databasePath)
  const api = createApiHandler(options)
  const expectedHost = new URL(options.origin).host
  const server = createServer(async (request, response) => {
    if (request.headers.host !== expectedHost) {
      response.writeHead(403).end('Use the configured SALEANE address.')
      return
    }
    if (request.url?.startsWith('/api/')) {
      await api(request, response)
      return
    }
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', options.origin).pathname)
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.startsWith('/api')) {
        response.writeHead(404).end('Not found.')
        return
      }
      const canonicalRoot = await realpath(root)
      let filename = resolve(
        root,
        `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`,
      )
      if (!filename.startsWith(`${root}${sep}`)) {
        response.writeHead(404).end('Not found.')
        return
      }
      let info
      try {
        info = await stat(filename)
      } catch {
        if (extname(pathname)) {
          response.writeHead(404).end('Not found.')
          return
        }
        filename = resolve(root, 'index.html')
        info = await stat(filename)
      }
      const canonicalFile = await realpath(filename)
      if (!canonicalFile.startsWith(`${canonicalRoot}${sep}`) || !info.isFile()) {
        response.writeHead(404).end('Not found.')
        return
      }
      const extension = extname(filename).toLowerCase()
      response.setHeader('Content-Type', types[extension] ?? 'application/octet-stream')
      response.setHeader('Content-Length', info.size)
      response.setHeader(
        'Cache-Control',
        extension === '.html'
          ? 'no-cache'
          : pathname.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
      )
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      const stream = createReadStream(canonicalFile)
      stream.on('error', () => {
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
      stream.pipe(response)
    } catch {
      if (!response.headersSent) response.writeHead(404)
      response.end('The built application is unavailable. Build it before starting this host.')
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.on('close', () => api.close())
  return { server, api }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? '5173')
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('PORT must be between 1024 and 65535.')
  const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`
  const { server, api } = createLocalServer({
    origin,
    databasePath: process.env.DB_PATH,
    staticRoot: process.env.STATIC_ROOT,
  })
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    server.close()
    server.closeIdleConnections()
    const timeout = setTimeout(() => server.closeAllConnections(), 5000)
    timeout.unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  server.on('error', () => {
    api.close()
    process.exitCode = 1
    console.error('SALEANE could not start. Check the address, port and database path.')
  })
  server.listen(port, '127.0.0.1', () => console.info(`SALEANE local application: ${origin}`))
}
