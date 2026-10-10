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

  it('keeps the rest of a question that arrives after a pause and after it is handed over', async () => {
    let now = 0
    const asked: string[] = []
    const talk = conversation({
      ...options(async (heard) => {
        asked.push(heard)
        return { text: `Answered: ${heard}` }
      }),
      quietMs: 300,
      clock: () => now,
    })
    const { fake } = line()
    talk.use(fake)
    talk.handle({ type: 'heard', text: 'Who is ' })
    // OpenAI hands the question over after a pause, and its last words arrive after that.
    now = 400
    talk.handle({ type: 'delegated', id: 'd1' })
    now = 450
    talk.handle({ type: 'heard', text: 'in at ten?' })
    now = 2000
    await talk.settled()
    talk.handle({ type: 'heard', text: 'Thanks.' })
    talk.handle({ type: 'delegated', id: 'd2' })
    now = 4000
    await talk.settled()
    expect(asked).toEqual(['Who is in at ten?', 'Thanks.'])
  })

  it('places words by when they were said, where OpenAI gives their place in the talk', async () => {
    let now = 0
    const asked: string[] = []
    const talk = conversation({
      ...options(async (heard) => {
        asked.push(heard)
        return { text: `Answered: ${heard}` }
      }),
      quietMs: 300,
      clock: () => now,
    })
    const { fake } = line()
    talk.use(fake)
    talk.handle({ type: 'heard', text: 'Who is in', startMs: 1000 })
    talk.handle({ type: 'delegated', id: 'd1', offsetMs: 2000 })
    // Late words said before the hand-over stay with the question; words said after it start
    // the next one, even though they arrive within the moment's quiet.
    now = 50
    talk.handle({ type: 'heard', text: ' at ten?', startMs: 1500 })
    now = 100
    talk.handle({ type: 'heard', text: 'Thanks.', startMs: 2600 })
    // A fragment said before the first hand-over that arrives after the next words still joins
    // its question, which has not yet gone to be answered, in the place it was said.
    talk.handle({ type: 'heard', text: ' please', startMs: 1900 })
    talk.handle({ type: 'delegated', id: 'd2', offsetMs: 3000 })
    // Even once the next question is handed over, words said before the first hand-over are the
    // first question's while it has not gone to be answered.
    talk.handle({ type: 'heard', text: ' now', startMs: 1950 })
    now = 2000
    await talk.settled()
    expect(asked).toEqual(['Who is in at ten? please now', 'Thanks.'])
  })

  it('waits for late words OpenAI places before the hand-over, beyond a moment’s quiet', async () => {
    let now = 0
    const asked: string[] = []
    const talk = conversation({
      ...options(async (heard) => {
        asked.push(heard)
        return { text: 'Answered.' }
      }),
      quietMs: 300,
      waitForWordsMs: 1500,
      clock: () => now,
    })
    const tick = () => new Promise((done) => setTimeout(done, 80))
    const { fake } = line()
    talk.use(fake)
    // The words heard so far end well before the hand-over, so more may be on their way.
    talk.handle({ type: 'heard', text: 'Who is in', startMs: 1000, endMs: 1400 })
    talk.handle({ type: 'delegated', id: 'd1', offsetMs: 3000 })
    now = 700
    await tick()
    expect(asked).toEqual([])
    // They arrive 700 ms later, and the question waits for them.
    talk.handle({ type: 'heard', text: ' at ten?', startMs: 1500, endMs: 1900 })
    now = 1200
    await tick()
    expect(asked).toEqual([])
    // With nothing more by the longest wait, the question goes as heard.
    now = 1600
    await talk.settled()
    expect(asked).toEqual(['Who is in at ten?'])
    // Words that reach the hand-over need only the moment's quiet.
    talk.handle({ type: 'heard', text: 'And at noon?', startMs: 3500, endMs: 4600 })
    talk.handle({ type: 'delegated', id: 'd2', offsetMs: 5000 })
    now = 2000
    await talk.settled()
    expect(asked).toEqual(['Who is in at ten?', 'And at noon?'])
    // A late fragment of a question already being answered is not added to the next one.
    talk.handle({ type: 'heard', text: ' please', startMs: 4700, endMs: 4800 })
    talk.handle({ type: 'heard', text: 'Thanks.', startMs: 5200, endMs: 5600 })
    talk.handle({ type: 'delegated', id: 'd3', offsetMs: 6000 })
    now = 2400
    await talk.settled()
    expect(asked).toEqual(['Who is in at ten?', 'And at noon?', 'Thanks.'])
  })

  it('asks nothing when the talk ends while the last words are awaited', async () => {
    let now = 0
    const asked: string[] = []
    const talk = conversation({
      ...options(async (heard) => {
        asked.push(heard)
        return { text: 'Answered.' }
      }),
      quietMs: 300,
      clock: () => now,
    })
    const { fake, said } = line()
    talk.use(fake)
    talk.handle({ type: 'heard', text: 'What is on today?' })
    talk.handle({ type: 'delegated', id: 'd1' })
    // Still waiting for any last words when the person hangs up.
    await new Promise((done) => setTimeout(done, 30))
    talk.handle({ type: 'closed', reason: 'close_requested', seconds: 5 })
    now = 1000
    await talk.settled()
    expect(asked).toEqual([])
    expect(said.filter((s) => s.kind === 'answer')).toEqual([])
  })

  it('asks and answers nothing once SALEANE has asked to end the talk', async () => {
    let now = 0
    const asked: string[] = []
    let release: (() => void) | undefined
    const talk = conversation({
      ...options(async (heard) => {
        asked.push(heard)
        if (heard.startsWith('First')) await new Promise<void>((done) => (release = done))
        return { text: `Answered: ${heard}` }
      }),
      quietMs: 300,
      clock: () => now,
    })
    const { fake, said } = line()
    talk.use(fake)
    // One question is with Claude and another is still gathering its words when Stop is pressed.
    talk.handle({ type: 'heard', text: 'First question?' })
    talk.handle({ type: 'delegated', id: 'd1' })
    now = 400
    await new Promise((done) => setTimeout(done, 80))
    talk.handle({ type: 'heard', text: 'Second question?' })
    talk.handle({ type: 'delegated', id: 'd2' })
    talk.stop()
    release!()
    now = 2000
    await talk.settled()
    expect(asked).toEqual(['First question?'])
    expect(said.filter((s) => s.kind === 'answer')).toEqual([])
    // OpenAI's confirmation still ends it as usual.
    talk.handle({ type: 'closed', reason: 'close_requested', seconds: 9 })
    expect(talk.ended).toEqual({ reason: 'close_requested' })
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

  it('gives a late word to its own question waiting its turn, after later ones are handed over', async () => {
    let release!: () => void
    const slow = new Promise<void>((done) => (release = done))
    const asked: string[] = []
    const talk = conversation({
      ...options(async (heard) => {
        asked.push(heard)
        if (heard === 'First?') await slow
        return { text: 'Answered.' }
      }),
      quietMs: 10,
      waitForWordsMs: 200,
    })
    const { fake } = line()
    talk.use(fake)
    talk.handle({ type: 'heard', text: 'First?', startMs: 0, endMs: 900 })
    talk.handle({ type: 'delegated', id: 'd1', offsetMs: 1000 })
    await new Promise((done) => setTimeout(done, 40))
    // While Claude answers the first, two more are handed over, and a word said before the
    // second hand-over arrives only after the third.
    talk.handle({ type: 'heard', text: 'Who is in', startMs: 1200, endMs: 1600 })
    talk.handle({ type: 'delegated', id: 'd2', offsetMs: 2000 })
    talk.handle({ type: 'heard', text: 'Thanks.', startMs: 2200, endMs: 2900 })
    talk.handle({ type: 'delegated', id: 'd3', offsetMs: 3000 })
    talk.handle({ type: 'heard', text: ' at ten?', startMs: 1650, endMs: 1950 })
    release()
    await talk.settled()
    expect(asked).toEqual(['First?', 'Who is in at ten?', 'Thanks.'])
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
