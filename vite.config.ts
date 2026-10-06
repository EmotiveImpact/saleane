import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        studies: fileURLToPath(new URL('./design-studies/index.html', import.meta.url)),
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', restoreMocks: true },
})
