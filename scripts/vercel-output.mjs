/* global console */
// Assembles Vercel's Build Output API folder (.vercel/output) after `vite build` has made dist/
// and the function bundle: the pages as plain files, and one function answering every /api path.
// See https://vercel.com/docs/build-output-api
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

const out = '.vercel/output'
const fn = `${out}/functions/api.func`
if (!existsSync('dist/index.html'))
  throw new Error('Run vite build first: dist/index.html is missing.')
if (!existsSync(`${fn}/index.mjs`))
  throw new Error(`The function bundle ${fn}/index.mjs is missing.`)

rmSync(`${out}/static`, { recursive: true, force: true })
mkdirSync(`${out}/static`, { recursive: true })
cpSync('dist', `${out}/static`, { recursive: true })

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: false,
      maxDuration: 60,
      memory: 1024,
      // Next to the Neon database in London.
      regions: ['lhr1'],
    },
    null,
    2,
  ),
)
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }))

// The same page headers the standalone host sends (server/index.ts).
const page = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; frame-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}
writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api(?:/.*)?$', dest: '/api' },
        {
          src: '^/assets/(.*)$',
          headers: { ...page, 'Cache-Control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        { src: '^/(.*)$', headers: page, continue: true },
        { handle: 'filesystem' },
        // A page address with no file behind it is one of the app's own screens.
        { src: '^/(?!.*\\.[A-Za-z0-9]+$).*$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)
console.info('Vercel output ready in .vercel/output')
