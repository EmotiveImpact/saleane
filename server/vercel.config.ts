import { defineConfig } from 'vite'

// The Vercel Function bundle (server/vercel.ts): one file with every package inside, since the
// function folder has no node_modules. pg-native is pg's optional C binding, never loaded here.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'server/vercel.ts',
    outDir: '.vercel/output/functions/api.func',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      external: ['pg-native'],
      output: {
        format: 'es',
        entryFileNames: 'index.mjs',
        codeSplitting: false,
        // Bundled CommonJS packages (pg) still call require for Node's own modules.
        banner:
          "import { createRequire as __saleaneRequire } from 'node:module'; const require = __saleaneRequire(import.meta.url);",
      },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
