import { describe, expect, it } from 'vitest'
import type { Notice } from './insights'
import { noticeQuestion, nudges } from './nudges'
import { seed } from './seed'

const today = '2026-10-06'
const at = '2026-10-06T09:00:00.000Z'
const notice = (kind: Notice['kind'], clientId?: string): Notice => ({
  id: kind,
  kind,
  title: 'A notice',
  detail: 'What it is about.',
  managersOnly: false,
  clientId,
})

describe('the question that follows a notice', () => {
  it('asks about what the notice raised, not a general question', () => {
    const s = seed('UK')
    expect(noticeQuestion(s, notice('low-stock'), true)).toBe('What should I reorder?')
    expect(noticeQuestion(s, notice('quiet-day'), false)).toBe('Who is due back?')
    expect(noticeQuestion(s, notice('takings-down'), true)).toBe('How was the week?')
    expect(noticeQuestion(s, notice('missed-visits', 'client-4'), false)).toBe(
      'Tell me about Noor Ahmed',
    )
  })

  it('keeps to questions the person’s role may ask', () => {
    const s = seed('UK')
    // The week's review is for owners and managers; the desk is offered who could fill the gaps.
    expect(noticeQuestion(s, notice('cancellations'), true)).toBe('How was the week?')
    expect(noticeQuestion(s, notice('cancellations'), false)).toBe('Who is due back?')
    expect(noticeQuestion(s, notice('missed-visits', 'client-gone'), false)).toBe(
      'Anything unusual?',
    )
  })

  it('follows the sample studio’s low stock with what to reorder', () => {
    // The full sample: in the named clients' quieter week, takings come before stock.
    const low = nudges(seed('UK', { regulars: true }), 'owner', today, at).find((n) =>
      /running low/.test(n.text),
    )
    expect(low).toMatchObject({
      text: 'Enzyme Peel, professional size is running low. At or below the level where you reorder.',
      ask: 'What should I reorder?',
    })
  })
})
