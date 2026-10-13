// Builds LUMANE's install page as one self-contained file, for a chat app to show or for anyone
// to open: npm run lumane:page. It writes lumane/install/dist/install-lumane.html.
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const out = here('../dist/')

/** Folds the built script and stylesheet into the page so it is a single file. */
function singleFile(): Plugin {
  return {
    name: 'lumane-install-single-file',
    apply: 'build',
    closeBundle() {
      if (!existsSync(out + 'index.html')) return
      let html = readFileSync(out + 'index.html', 'utf8')
      html = html.replace(
        /<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/g,
        (_, name) => `<style>${readFileSync(out + 'assets/' + name, 'utf8')}</style>`,
      )
      html = html.replace(
        /<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/g,
        (_, name) =>
          `<script type="module">${readFileSync(out + 'assets/' + name, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`,
      )
      for (const name of readdirSync(out + 'assets'))
        if (html.includes(`assets/${name}`)) throw new Error(`${name} was not inlined`)
      rmSync(out + 'assets', { recursive: true })
      writeFileSync(out + 'install-lumane.html', html)
      rmSync(out + 'index.html')
    },
  }
}

export default defineConfig({
  root: here('.'),
  base: './',
  publicDir: false,
  plugins: [react(), singleFile()],
  build: { outDir: out, emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false },
})
