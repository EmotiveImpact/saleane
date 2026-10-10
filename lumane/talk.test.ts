import { describe, expect, it } from 'vitest'
import { conversation } from './talk'
import type { ConversationOptions } from './talk'
import type { LiveLine } from './live'

// One spoken conversation: words heard, questions handed over, and the answers given back.
function line() {
  const said: { kind: 'answer' | 'note'; id: string; text: string }[] = []
  const fake: LiveLine = {
    answer: (id, text) => said.push({ kind: 'answer', id, text }),
    note: (id, text) => said.push({ kind: 'note', id, text }),
    close: () => {},
    detach: () => {},
  }
  return { fake, said }
}
const options = (think: ConversationOptions['think']): ConversationOptions => ({
  think,
  progress: 'Looking now.',
  unheard: 'Ask them to say it again.',
  failed: 'Nothing could be answered.',
  waitForWordsMs: 200,
  quietMs: 10,
})

describe('a spoken conversation', () => {
  it('answers what was heard, with the conversation so far', async () => {
    const asked: { heard: string; history: unknown[] }[] = []
    const talk = conversation(
      options(async (heard, history) => {
        asked.push({ heard, history })
        return heard.startsWith('Who')
          ? { text: 'Amelia at ten.' }
          : {
              text: 'I have prepared a reminder for you to approve.',
              proposals: [{ id: 'p1', summary: 'Remind: call Amelia', expiresAt: 'later' }],
            }
      }),
    )
    const { fake, said } = line()
    talk.use(fake)
    talk.handle({ type: 'heard', text: 'Who is my ' })
    talk.handle({ type: 'heard', text: 'first visit?' })
    talk.handle({ type: 'delegated', id: 'd1' })
    await talk.settled()
    talk.handle({ type: 'heard', text: 'Remind me to call her.' })
    talk.handle({ type: 'delegated', id: 'd2' })
    await talk.settled()
    expect(asked).toEqual([
      { heard: 'Who is my first visit?', history: [] },
      {
        heard: 'Remind me to call her.',
        history: [
          { from: 'you', text: 'Who is my first visit?' },
          { from: 'saleane', text: 'Amelia at ten.' },
        ],
      },
    ])
    expect(said).toEqual([
      { kind: 'note', id: 'd1', text: 'Looking now.' },
      { kind: 'answer', id: 'd1', text: 'Amelia at ten.' },
      { kind: 'note', id: 'd2', text: 'Looking now.' },
      { kind: 'answer', id: 'd2', text: 'I have prepared a reminder for you to approve.' },
    ])
    expect(talk.turns).toEqual([
      { id: 'd1', heard: 'Who is my first visit?', answer: 'Amelia at ten.', proposals: [] },
      {
        id: 'd2',
        heard: 'Remind me to call her.',
        answer: 'I have prepared a reminder for you to approve.',
        proposals: [{ id: 'p1', summary: 'Remind: call Amelia', expiresAt: 'later' }],
      },
    ])
  })

  it('waits for words that arrive just after the question is handed over', async () => {
    const talk = conversation(options(async (heard) => ({ text: `You said ${heard}` })))
    const { fake, said } = line()
    talk.use(fake)
    talk.handle({ type: 'delegated', id: 'd1' })
    setTimeout(() => talk.handle({ type: 'heard', text: 'hello' }), 30)
    await talk.settled()
    expect(said.at(-1)).toEqual({ kind: 'answer', id: 'd1', text: 'You said hello' })
  })

  it('asks again when nothing was heard, and says plainly when no answer came', async () => {
    const talk = conversation(
      options(async () => {
        throw new Error('down')
      }),
    )
    const { fake, said } = line()
    talk.use(fake)
    talk.handle({ type: 'delegated', id: 'd1' })
    await talk.settled()
    talk.handle({ type: 'heard', text: 'What is on today?' })
    talk.handle({ type: 'delegated', id: 'd2' })
    await talk.settled()
    expect(said.filter((s) => s.kind === 'answer')).toEqual([
      { kind: 'answer', id: 'd1', text: 'Ask them to say it again.' },
      { kind: 'answer', id: 'd2', text: 'Nothing could be answered.' },
    ])
    expect(talk.turns).toHaveLength(1)
  })

  it('answers one question at a time, in order, and gives nothing to a talk that has ended', async () => {
    let release!: () => void
    const slow = new Promise<void>((done) => (release = done))
    const order: string[] = []
    const talk = conversation(
      options(async (heard) => {
        order.push(`start ${heard}`)
        if (heard === 'one') await slow
        order.push(`end ${heard}`)
        return { text: heard.toUpperCase() }
      }),
    )
    const { fake, said } = line()
    talk.use(fake)
    talk.handle({ type: 'heard', text: 'one' })
    talk.handle({ type: 'delegated', id: 'd1' })
    await new Promise((done) => setTimeout(done, 40))
    talk.handle({ type: 'heard', text: 'two' })
    talk.handle({ type: 'delegated', id: 'd2' })
    await new Promise((done) => setTimeout(done, 40))
    expect(order).toEqual(['start one'])
    talk.handle({ type: 'usage', seconds: 20 })
    talk.handle({ type: 'closed', reason: 'close_requested', seconds: 25 })
    release()
    await talk.settled()
    // The second question is not taken up: the talk ended while the first was being answered.
    expect(order).toEqual(['start one', 'end one'])
    expect(said.filter((s) => s.kind === 'answer')).toEqual([])
    expect(talk.seconds).toBe(25)
    expect(talk.ended).toEqual({ reason: 'close_requested' })
  })

  it('keeps each question’s own words while an earlier one is still being answered', async () => {
    let release!: () => void
    const slow = new Promise<void>((done) => (release = done))
    const asked: string[] = []
    const talk = conversation(
      options(async (heard) => {
        asked.push(heard)
        if (heard === 'First question?') await slow
        return { text: `Answered: ${heard}` }
      }),
    )
    const { fake, said } = line()
    talk.use(fake)
    talk.handle({ type: 'heard', text: 'First question?' })
    talk.handle({ type: 'delegated', id: 'd1' })
    await new Promise((done) => setTimeout(done, 40))
    // Two more questions while Claude is still answering the first.
    talk.handle({ type: 'heard', text: 'Second ' })
    talk.handle({ type: 'heard', text: 'question?' })
    talk.handle({ type: 'delegated', id: 'd2' })
    await new Promise((done) => setTimeout(done, 40))
    talk.handle({ type: 'heard', text: 'Third question?' })
    talk.handle({ type: 'delegated', id: 'd3' })
    release()
    await talk.settled()
    expect(asked).toEqual(['First question?', 'Second question?', 'Third question?'])
    expect(said.filter((s) => s.kind === 'answer').map((s) => [s.id, s.text])).toEqual([
      ['d1', 'Answered: First question?'],
      ['d2', 'Answered: Second question?'],
      ['d3', 'Answered: Third question?'],
    ])
  })
})
