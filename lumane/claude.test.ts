import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BrainError,
  DECLINED,
  claudeBrain,
  claudeCost,
  claudeMessages,
  claudeTools,
  readSkill,
  runTurn,
} from '.'
import type { Allowance, BrainRequest } from '.'

// NEXT-12: Claude behind the brain interface, with Anthropic's Messages API pretended by a fetch
// that records what was sent and answers as Anthropic documents.
const prices = { input: 200, output: 1000, cacheRead: 10 }
type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function anthropic(...answers: (Record<string, unknown> | { status: number; body?: unknown })[]) {
  const sent: Sent[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    })
    const next = answers.shift()
    if (!next) throw new Error('No answer left')
    if ('status' in next && typeof next.status === 'number')
      return new Response(JSON.stringify(next.body ?? {}), {
        status: next.status,
        headers: { 'content-type': 'application/json' },
      })
    return new Response(JSON.stringify(next), { status: 200 })
  }) as unknown as typeof fetch
  return { sent, fetcher }
}
const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000 }
const words = (text: string, stop = 'end_turn') => ({
  content: [{ type: 'text', text }],
  stop_reason: stop,
  usage,
})
const brainWith = (fetcher: typeof fetch) =>
  claudeBrain({
    apiKey: 'test-key',
    model: 'claude-sonnet-5-5',
    prices,
    fetcher,
    wait: async () => {},
  })
const request: BrainRequest = {
  instructions: 'Be brief.',
  context: 'Today is Tuesday 6 October.',
  messages: [{ role: 'user', text: 'How many visits today?' }],
  tools: [
    {
      name: 'day_overview',
      description: 'The day.',
      inputSchema: z.toJSONSchema(z.object({ date: z.iso.date().optional() }).strict()) as Record<
        string,
        unknown
      >,
    },
  ],
}

describe('Claude through the Messages API', () => {
  it('sends the instructions, the facts apart, the skills and the question', async () => {
    const { sent, fetcher } = anthropic(words('You have 6 visits today.'))
    const reply = await brainWith(fetcher).respond(request)
    expect(reply).toEqual({ text: 'You have 6 visits today.', calls: [], costMinor: 0.34 })
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(sent[0].headers).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    expect(sent[0].body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 2048,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Today is Tuesday 6 October.' },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'How many visits today?' }] }],
    })
    const [tool] = sent[0].body.tools as Record<string, unknown>[]
    expect(tool).toEqual({
      name: 'day_overview',
      description: 'The day.',
      input_schema: {
        type: 'object',
        properties: { date: { type: 'string', format: 'date' } },
        additionalProperties: false,
      },
      cache_control: { type: 'ephemeral' },
    })
  })

  it('returns the skills Claude asks for, with its own reply to send back', async () => {
    const content = [
      { type: 'thinking', thinking: 'Look at the day.', signature: 'sig' },
      { type: 'tool_use', id: 'toolu_1', name: 'day_overview', input: {} },
    ]
    const { fetcher } = anthropic({ content, stop_reason: 'tool_use', usage })
    const reply = await brainWith(fetcher).respond(request)
    expect(reply.calls).toEqual([{ id: 'toolu_1', name: 'day_overview', input: {} }])
    expect(reply.raw).toEqual(content)
    expect(reply.text).toBeUndefined()
  })

  it('uses nothing from a reply cut off by the length limit, and says so when Claude declines', async () => {
    const { fetcher } = anthropic(
      {
        content: [
          { type: 'text', text: 'Let me look.' },
          { type: 'tool_use', id: 'toolu_2', name: 'day_overview', input: { date: '2026-1' } },
        ],
        stop_reason: 'max_tokens',
        usage,
      },
      { content: [], stop_reason: 'refusal', usage },
    )
    const brain = brainWith(fetcher)
    // A part-written reply is never shown or used, and what it cost is still counted.
    const cut = await brain.respond(request).catch((e: unknown) => e)
    expect(cut).toBeInstanceOf(BrainError)
    expect(cut).toMatchObject({ kind: 'failed', costMinor: claudeCost(usage, prices) })
    expect(await brain.respond(request)).toMatchObject({ text: DECLINED, calls: [] })
  })

  it('tries once more when Anthropic is busy, then gives up plainly', async () => {
    const overloaded = { status: 529, body: { type: 'error', error: { type: 'overloaded_error' } } }
    const once = anthropic(overloaded, words('Back now.'))
    expect((await brainWith(once.fetcher).respond(request)).text).toBe('Back now.')
    expect(once.sent).toHaveLength(2)

    const twice = anthropic(overloaded, overloaded)
    const error = await brainWith(twice.fetcher)
      .respond(request)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BrainError)
    expect(error).toMatchObject({ kind: 'busy', costMinor: 0 })
    expect(twice.sent).toHaveLength(2)
  })

  it('does not retry a refused key, and counts a dropped connection at its worst', async () => {
    const refused = anthropic({
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    })
    await expect(brainWith(refused.fetcher).respond(request)).rejects.toMatchObject({
      kind: 'refused',
      message: 'Anthropic refused the account (authentication_error: invalid x-api-key).',
    })
    expect(refused.sent).toHaveLength(1)

    const dropped = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const error = (await brainWith(dropped)
      .respond(request)
      .catch((e: unknown) => e)) as BrainError
    expect(error.kind).toBe('unreachable')
    // Every character of the request a token at the input price, and the longest reply.
    expect(error.costMinor).toBeGreaterThan(2)
  })

  it('works out the cost from the tokens, caching included, rounded up', () => {
    expect(claudeCost(usage, prices)).toBe(0.34)
    expect(
      claudeCost({ input_tokens: 10, cache_creation_input_tokens: 4000, output_tokens: 0 }, prices),
    ).toBe(1.01)
    expect(claudeCost({ input_tokens: 1000 }, { input: 300, output: 1500 })).toBe(0.3)
    expect(claudeCost({ cache_read_input_tokens: 1000 }, { input: 300, output: 1500 })).toBe(0.03)
    expect(claudeCost(undefined, prices)).toBe(0)
  })

  it('groups results, keeps Claude its own reply and opens with the person', () => {
    const raw = [{ type: 'tool_use', id: 't1', name: 'a', input: {} }]
    expect(
      claudeMessages([
        { role: 'assistant', text: 'Hello again.', calls: [] },
        { role: 'user', text: 'Two things.' },
        { role: 'user', text: ' ' },
        { role: 'assistant', calls: [{ id: 't1', name: 'a', input: {} }], raw },
        { role: 'tool', callId: 't1', result: '{"n":1}' },
        { role: 'tool', callId: 't2', result: 'No.', isError: true },
      ]),
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Two things.' }] },
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"n":1}' },
          { type: 'tool_result', tool_use_id: 't2', content: 'No.', is_error: true },
        ],
      },
    ])
  })

  it('leaves a field named like a schema word alone', () => {
    const schema = z.toJSONSchema(
      z.object({ pattern: z.string(), when: z.iso.date() }).strict(),
    ) as Record<string, unknown>
    const [tool] = claudeTools([{ name: 'x', description: 'y', inputSchema: schema }])
    expect(tool.input_schema).toMatchObject({
      properties: { pattern: { type: 'string' }, when: { type: 'string', format: 'date' } },
    })
    expect(JSON.stringify(tool.input_schema)).not.toContain('$schema')
  })
})

describe('A turn with Claude', () => {
  const allowance: Allowance = {
    monthly: { typed: 10, talkSeconds: 600, guestChats: 10 },
    dailySpendCeilingMinor: 100,
    monthlySpendCeilingMinor: 300,
    perPersonHourly: 10,
    maxTalkSessionSeconds: 300,
  }
  const skills = [
    readSkill<{ visits: number }, Record<string, never>>({
      name: 'count_visits',
      description: 'How many visits today.',
      input: z.object({}).strict(),
      allowed: () => true,
      run: (ctx) => ({ visits: ctx.visits }),
    }),
  ]
  const meter = {
    allowance,
    usage: undefined,
    personId: 'p1',
    at: '2026-10-07T09:00:00.000Z',
    kind: 'typed' as const,
    worstCaseMinor: 6,
  }

  it('uses a skill, sends the result back with Claude own reply, then answers', async () => {
    const content = [
      { type: 'thinking', thinking: 'Count them.', signature: 'sig-1' },
      { type: 'tool_use', id: 'toolu_9', name: 'count_visits', input: {} },
    ]
    const { sent, fetcher } = anthropic(
      { content, stop_reason: 'tool_use', usage },
      words('You have 6 visits today.'),
    )
    const result = await runTurn({
      brain: brainWith(fetcher),
      skills,
      ctx: { visits: 6 },
      instructions: 'Be brief.',
      context: 'Today is Wednesday 7 October.',
      history: [],
      text: 'How many visits today?',
      meter,
    })
    expect(result).toMatchObject({
      status: 'answered',
      text: 'You have 6 visits today.',
      costMinor: 0.68,
    })
    expect(sent[1].body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'How many visits today?' }] },
      { role: 'assistant', content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: '{"visits":6}' }],
      },
    ])
  })

  it('ends as unavailable when Claude cannot answer, keeping what it cost', async () => {
    const { fetcher } = anthropic(
      {
        content: [{ type: 'tool_use', id: 'toolu_9', name: 'count_visits', input: {} }],
        stop_reason: 'tool_use',
        usage,
      },
      { status: 400, body: { type: 'error', error: { type: 'invalid_request_error' } } },
    )
    const result = await runTurn({
      brain: brainWith(fetcher),
      skills,
      ctx: { visits: 6 },
      instructions: 'Be brief.',
      history: [],
      text: 'How many visits today?',
      meter,
    })
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'failed',
      detail: 'Claude could not answer (invalid_request_error).',
      text: 'Sorry, I could not answer just now. Nothing was changed. Please try again shortly.',
      costMinor: 0.34,
    })
    if (result.status !== 'unavailable') throw new Error('expected unavailable')
    // Not counted against the month, but its cost and the hourly count are.
    expect(result.usage.used.typed).toBe(0)
    expect(result.usage.spendByDay['2026-10-07']).toBe(0.34)
    expect(result.usage.recent.p1).toHaveLength(1)
  })
})
