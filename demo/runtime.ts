// Runs before anything else: the Node globals the shared server code expects.
import { Buffer } from './shims/buffer'

const scope = globalThis as unknown as Record<string, unknown>
scope.Buffer = Buffer
scope.process ??= { env: {}, platform: 'browser' }
// server/http.ts calls timer.unref(); browser timers are plain numbers.
;(Number.prototype as unknown as { unref: () => unknown }).unref = function () {
  return this
}
