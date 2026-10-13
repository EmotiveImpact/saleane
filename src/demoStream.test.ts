import { describe, expect, it } from 'vitest'
import { Writable } from '../demo/shims/stream'

// The click-through demo answers /api/* in the page with server/http.ts's inject(), over this
// stand-in for Node's streams. Ask SALEANE listens for the response closing and stops listening
// when it answers, so the stand-in needs both, as Node's own streams have.
describe("the demo's stream stand-in", () => {
  it('stops calling a listener taken off with off()', () => {
    const response = new Writable({ write: () => {} })
    let calls = 0
    const listener = () => calls++
    response.on('close', listener)
    response.emit('close')
    response.off('close', listener)
    response.emit('close')
    expect(calls).toBe(1)
  })

  it('says it has finished once the response is written', async () => {
    const response = new Writable({ write: () => {} })
    const finished = new Promise<void>((resolve) => response.on('finish', () => resolve()))
    expect(response.writableFinished).toBe(false)
    response.end('done')
    await finished
    expect(response.writableFinished).toBe(true)
  })
})
