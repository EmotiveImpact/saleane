// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { KEIKI_ENDPOINT, aiFromEnv } from './ai'
import type { BusinessState } from '../src/domain/model'

// Keiki as SALEANE's brain, through its Anthropic-compatible gateway. No real key or request.
const env = {
  SALEANE_AI_PROVIDER: 'keiki',
  KEIKI_API_KEY: 'fictional-keiki-key',
  KEIKI_AGENT: 'saleane-receptionist',
  SALEANE_AI_PRICES: '300,1500',
}
const realStudio = { operations: { mode: 'local' } } as unknown as BusinessState
const sampleStudio = { operations: { mode: 'sandbox' } } as unknown as BusinessState

describe('Keiki as the AI supplier', () => {
  it('needs its key, the agent and a price it can count, kept on the server', () => {
    expect(() => aiFromEnv({ ...env, KEIKI_API_KEY: '' })).toThrow(/KEIKI_API_KEY/)
    expect(() => aiFromEnv({ ...env, KEIKI_AGENT: '' })).toThrow(/KEIKI_AGENT/)
    expect(() => aiFromEnv({ ...env, SALEANE_AI_PRICES: '' })).toThrow(/SALEANE_AI_PRICES/)
    expect(() => aiFromEnv({ ...env, KEIKI_ENDPOINT: 'http://insecure.invalid' })).toThrow(/https/)
    const ai = aiFromEnv(env)
    expect(ai).toMatchObject({ name: 'keiki', live: true, model: 'saleane-receptionist' })
    // Sample studios never leave SALEANE.
    expect(ai.brainFor(sampleStudio, 'reception')).toBeUndefined()
    expect(ai.brainFor(realStudio, 'reception')).toBeDefined()
  })

  it("sends SALEANE's own instructions and skills to the agent, and counts the cost", async () => {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
      []
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      })
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'We have Tuesday at 10:00.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1000, output_tokens: 100 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const brain = aiFromEnv(env, fetcher).brainFor(realStudio, 'reception')!
    const reply = await brain.respond({
      instructions: 'You are the AI receptionist.',
      messages: [{ role: 'user', text: 'Anything on Tuesday?' }],
      tools: [
        {
          name: 'find_free_times',
          description: 'Free times',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })
    expect(reply.text).toBe('We have Tuesday at 10:00.')
    // 1,000 input at 300 and 100 output at 1,500 cents per million: 0.45 cents.
    expect(reply.costMinor).toBe(0.45)
    expect(seen[0].url).toBe(KEIKI_ENDPOINT)
    expect(seen[0].headers['x-api-key']).toBe('fictional-keiki-key')
    expect(seen[0].body.model).toBe('saleane-receptionist')
    expect(seen[0].body).not.toHaveProperty('output_config')
    expect(seen[0].body.tools).toEqual([
      {
        name: 'find_free_times',
        description: 'Free times',
        input_schema: { type: 'object', properties: {} },
      },
    ])
  })

  it('says Keiki, not Claude, when the gateway refuses', async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify({ error: { type: 'permission_error', message: 'gateway disabled' } }),
        {
          status: 403,
        },
      )) as unknown as typeof fetch
    const brain = aiFromEnv(env, fetcher).brainFor(realStudio, 'ask')!
    await expect(
      brain.respond({ instructions: 'x', messages: [{ role: 'user', text: 'hi' }], tools: [] }),
    ).rejects.toThrow(/Keiki refused the account/)
  })
})
