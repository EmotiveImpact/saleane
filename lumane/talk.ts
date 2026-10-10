import type { LiveEvent, LiveLine } from './live'

/** One question asked out loud and what the app answered. */
export type TalkTurn = {
  id: string
  heard: string
  /** The app's answer, as given to the voice to say. Missing while it is still thinking. */
  answer?: string
  /** Changes prepared while answering, waiting for the person to approve them on screen. */
  proposals: { id: string; summary: string; expiresAt: string }[]
}

export type Thought = { text: string; proposals?: TalkTurn['proposals'] }

export type ConversationOptions = {
  /**
   * Answers what the person asked, given the conversation so far, oldest first. A refusal or an
   * answer the AI could not give comes back as text to say, not as an error.
   */
  think(heard: string, history: { from: 'you' | 'saleane'; text: string }[]): Promise<Thought>
  /** A quiet note for the voice while the answer is prepared. */
  progress: string
  /** What the voice is given when no words came with a question. */
  unheard: string
  /** What the voice is given when the answer could not be prepared at all. */
  failed: string
  /** How many earlier turns go with each question. */
  historyTurns?: number
  /** The longest wait for a question's words, which can arrive just after it is handed over. */
  waitForWordsMs?: number
  /** How long the words must have stopped before the question is taken as complete. */
  quietMs?: number
  clock?: () => number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Follows one spoken conversation: gathers what the person says, and each time the voice hands a
 * question over, answers it with the app's own brain and gives the voice the answer to say.
 * Questions are answered one at a time, in the order they were asked.
 */
export function conversation(options: ConversationOptions) {
  const clock = options.clock ?? Date.now
  const turns: TalkTurn[] = []
  let line: LiveLine | undefined
  let heard = ''
  let heardAt = 0
  let seconds = 0
  let ended: { reason: string } | undefined
  let queue: Promise<void> = Promise.resolve()

  /** Waits for the question's words: some heard, then a moment's quiet, or the longest wait. */
  async function words() {
    const started = clock()
    const longest = options.waitForWordsMs ?? 1500
    const quiet = options.quietMs ?? 300
    while (clock() - started < longest) {
      if (heard.trim() && clock() - heardAt >= quiet) return
      await sleep(Math.min(50, Math.max(1, quiet)))
    }
  }

  async function answer(delegationId: string) {
    if (ended) return
    line?.note(delegationId, options.progress)
    await words()
    const asked = heard.trim()
    heard = ''
    if (!asked) {
      line?.answer(delegationId, options.unheard)
      return
    }
    const turn: TalkTurn = { id: delegationId, heard: asked, proposals: [] }
    const history = turns
      .filter((t) => t.answer !== undefined)
      .slice(-(options.historyTurns ?? 3))
      .flatMap((t) => [
        { from: 'you' as const, text: t.heard },
        { from: 'saleane' as const, text: t.answer! },
      ])
    turns.push(turn)
    let thought: Thought
    try {
      thought = await options.think(asked, history)
    } catch {
      thought = { text: options.failed }
    }
    turn.answer = thought.text
    turn.proposals = thought.proposals ?? []
    if (!ended) line?.answer(delegationId, thought.text)
  }

  return {
    /** Gives the conversation the line to answer on, once the session is followed. */
    use(next: LiveLine) {
      line = next
    },
    handle(event: LiveEvent) {
      switch (event.type) {
        case 'heard':
          heard += event.text
          heardAt = clock()
          break
        case 'delegated':
          queue = queue.then(() => answer(event.id)).catch(() => undefined)
          break
        case 'usage':
          seconds = Math.max(seconds, event.seconds)
          break
        case 'closed':
          ended = { reason: event.reason }
          seconds = Math.max(seconds, event.seconds ?? 0)
          break
        case 'lost':
          ended ??= { reason: 'lost' }
          break
      }
    },
    /** Resolves once every question handed over so far has been answered. */
    settled: () => queue,
    get turns() {
      return turns
    },
    /** The session's length so far, as the supplier last reported it. */
    get seconds() {
      return seconds
    },
    get ended() {
      return ended
    },
  }
}

export type Conversation = ReturnType<typeof conversation>
