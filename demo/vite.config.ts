// Builds SALEANE as one self-contained HTML file: the app, the real server code and a SQLite
// engine, all running in the visitor's browser with fictional studios. Nothing is deployed.
//   npm --prefix demo install && npx vite build --config demo/vite.config.ts
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const publicImages = here('../public/images/')

/** Public images are referenced by absolute path; the single file carries them inline instead. */
function inlineImages(): Plugin {
  const cache = new Map<string, string>()
  const dataUri = (name: string) => {
    if (!cache.has(name)) {
      const file = publicImages + name
      const bytes = name.endsWith('.png')
        ? execFileSync('convert', [file, '-resize', '1600x1600>', '-quality', '82', 'jpg:-'])
        : readFileSync(file)
      cache.set(name, `data:image/jpeg;base64,${bytes.toString('base64')}`)
    }
    return cache.get(name)!
  }
  return {
    name: 'saleane-demo-images',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/src\/.*\.(tsx?|css)$/.test(id) || !code.includes('/images/')) return null
      return code.replace(/\/images\/([\w.-]+\.(?:jpg|png))/g, (_, name: string) => dataUri(name))
    },
  }
}

/**
 * Sample studios never send messages in the real server. The demo only has sample studios, so here
 * they produce test-mode messages (never sent anywhere) to show what a real studio would see.
 */
function sampleMessages(): Plugin {
  const swaps: Record<string, [string, string][]> = {
    '/server/messaging/outbox.ts': [
      [
        "json_extract(state,'$.operations.mode')='local'",
        "json_extract(state,'$.operations.mode') IN ('local','sandbox')",
      ],
      ["operations(org.state).mode !== 'local'", 'false'],
    ],
    '/src/domain/reminders.ts': [["if (operations(s).mode !== 'local') return []", '']],
  }
  return {
    name: 'saleane-demo-sample-messages',
    enforce: 'pre',
    transform(code, id) {
      const file = Object.keys(swaps).find((name) => id.endsWith(name))
      if (!file) return null
      for (const [from, to] of swaps[file]) {
        if (!code.includes(from)) throw new Error(`Demo build: ${file} no longer contains ${from}`)
        code = code.replace(from, to)
      }
      return code
    },
  }
}

/** Folds the built script and stylesheet into index.html so the demo is a single file. */
function singleFile(): Plugin {
  return {
    name: 'saleane-demo-single-file',
    apply: 'build',
    closeBundle() {
      const out = here('./dist/')
      // A failed build still closes; leave its own error as the one reported.
      if (!existsSync(out + 'index.html')) return
      let html = readFileSync(out + 'index.html', 'utf8')
      const assets = readdirSync(out + 'assets')
      html = html.replace(
        /<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/g,
        (_, name) => `<style>${readFileSync(out + 'assets/' + name, 'utf8')}</style>`,
      )
      html = html.replace(
        /<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/g,
        (_, name) =>
          `<script type="module">${readFileSync(out + 'assets/' + name, 'utf8')
            .replace(/<\/script/gi, '<\\/script')
            .replace(/\uFFFD/g, '\\uFFFD')}</script>`,
      )
      for (const name of assets)
        if (html.includes(`assets/${name}`)) throw new Error(`${name} was not inlined`)
      rmSync(out + 'assets', { recursive: true })
      // Artifact hosting adds its own document skeleton, so publish the page's content only.
      const title = html.match(/<title>.*?<\/title>/)![0]
      const styles = html.match(/<style>[\s\S]*?<\/style>/g)!.join('')
      const script = html.match(/<script type="module">[\s\S]*<\/script>/)![0]
      writeFileSync(
        out + 'saleane-demo.html',
        `${title}\n${styles}\n<div id="root"></div>\n${script}\n`,
      )
      rmSync(out + 'index.html')
    },
  }
}

export default defineConfig({
  root: here('.'),
  base: './',
  publicDir: false,
  plugins: [inlineImages(), sampleMessages(), react(), singleFile()],
  resolve: {
    alias: [
      { find: 'node:sqlite', replacement: here('./shims/sqlite.ts') },
      { find: 'node:crypto', replacement: here('./shims/crypto.ts') },
      { find: 'node:stream', replacement: here('./shims/stream.ts') },
      { find: 'node:fs', replacement: here('./shims/fs.ts') },
      { find: 'node:path', replacement: here('./shims/path.ts') },
    ],
  },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 8000,
    rollupOptions: { output: { codeSplitting: false } },
  },
})
