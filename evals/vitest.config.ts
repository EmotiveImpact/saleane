import { defineConfig } from 'vitest/config'

// The eval cases against the real AI: run with `npm run evals`, never as part of `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['evals/**/*.eval.ts'],
    testTimeout: 60000,
    maxWorkers: 1,
  },
})
