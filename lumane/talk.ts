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
  /**
   * Where the supplier places words on the talk's timeline: words that end this close to the
   * hand-over are taken as the end of the question; ones that end sooner may have more on the way.
   */
  reachMs?: number
  clock?: () => number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Words as they arrived, with where they start on the talk's timeline when the supplier says. */
type Words = { text: string; startMs?: number }[]

/**
 * Words in the order they were said: by their place on the timeline when every one has it,
 * otherwise as they arrived, as OpenAI advises.
 */
const spoken = (words: Words) =>
  (words.every((w) => w.startMs !== undefined)
    ? [...words].sort((a, b) => a.startMs! - b.startMs!)
    : words
  )
    .map((w) => w.text)
    .join('')

/**
 * The words of one question handed over. It takes what was said before it was handed over and
 * what follows just after, until the words stop for a moment or the longest wait passes; anything
 * said after that belongs to the next question, even while this one is still being answered.
 */
type Asked = {
  id: string
  words: Words
  at: number
  since: number
  closed: boolean
  /** Where it was handed over on the session's timeline, when the supplier says. */
  offsetMs?: number
  /** Where its words heard so far end on the timeline. */
  reachedMs?: number
  /** Words said after the hand-over have arrived, so its own are in. */
  followed?: boolean
}

/**
 * Follows one spoken conversation: gathers what the person says, and each time the voice hands a
 * question over, answers it with the app's own brain and gives the voice the answer to say.
 * Questions are answered one at a time, in the order they were asked.
 */
export function conversation(options: ConversationOptions) {
  const clock = options.clock ?? Date.now
  const turns: TalkTurn[] = []
  let line: LiveLine | undefined
  /** Words not yet part of a question handed over. */
  let heard: Words = []
  let heardAt = 0
  let heardTo: number | undefined
  let latest: Asked | undefined
  /** Where the question before the latest was handed over: words said before it are its. */
  let earlier: number | undefined
  let seconds = 0
  let ended: { reason: string } | undefined
  /** SALEANE asked the supplier to end the talk: nothing more is asked or answered meanwhile. */
  let stopping = false
  let queue: Promise<void> = Promise.resolve()

  const longest = options.waitForWordsMs ?? 1500
  const quiet = options.quietMs ?? 300
  const reach = options.reachMs ?? 1000
  /**
   * Whether a question's words are complete: some heard, then a moment's quiet, or the longest
   * wait. The quiet is counted from the hand-over at the earliest, so words that arrive just after
   * a pause and the hand-over still belong to the question they finish. Where the words have
   * places on the timeline, the quiet is enough only once they reach the hand-over or words said
   * after it have arrived; otherwise the longest wait gives late words their chance.
   */
  const complete = (q: Asked) => {
    if (q.closed) return true
    const waited = clock() - q.since >= longest
    if (!spoken(q.words).trim()) return waited
    if (clock() - Math.max(q.at, q.since) < quiet) return false
    if (q.offsetMs === undefined) return true
    return waited || q.followed || (q.reachedMs ?? -Infinity) >= q.offsetMs - reach
  }

  /** Waits for the question's words, then keeps them, whatever is said next. */
  async function words(q: Asked) {
    while (!complete(q)) await sleep(Math.min(50, Math.max(1, quiet)))
    q.closed = true
  }

  async function answer(q: Asked) {
    if (ended || stopping) return
    const delegationId = q.id
    line?.note(delegationId, options.progress)
    await words(q)
    // The talk may have ended, or been asked to end, while the last words were awaited: nothing
    // more is asked.
    if (ended || stopping) return
    const asked = spoken(q.words).trim()
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
    if (!ended && !stopping) line?.answer(delegationId, thought.text)
  }

  return {
    /** Gives the conversation the line to answer on, once the session is followed. */
    use(next: LiveLine) {
      line = next
    },
    handle(event: LiveEvent) {
      switch (event.type) {
        case 'heard': {
          const word = {
            text: event.text,
            ...(event.startMs === undefined ? {} : { startMs: event.startMs }),
          }
          const end = event.endMs ?? event.startMs
          // Where the supplier gives timeline positions, words are placed by when they were
          // said, not when they arrived: words said before a hand-over belong to its question
          // however late they arrive, until the question has gone to be answered; words said
          // after it start the next question and show the last one's words are in.
          const timed =
            latest?.offsetMs !== undefined && event.startMs !== undefined
              ? event.startMs < latest.offsetMs
              : undefined
          if (latest && timed) {
            const older = earlier !== undefined && event.startMs! < earlier
            if (!latest.closed && !older) {
              latest.words.push(word)
              latest.at = clock()
              if (end !== undefined) latest.reachedMs = Math.max(latest.reachedMs ?? end, end)
            }
            // Words of a question already being answered cannot change it now.
            break
          }
          if (latest && timed === undefined && !complete(latest)) {
            latest.words.push(word)
            latest.at = clock()
            break
          }
          if (latest && timed === false) latest.followed = true
          else if (latest) latest.closed = true
          heard.push(word)
          heardAt = clock()
          if (end !== undefined) heardTo = Math.max(heardTo ?? end, end)
          break
        }
        case 'delegated': {
          // Each question keeps its own words, so one waiting its turn is never given another's.
          if (latest) latest.closed = true
          earlier = latest?.offsetMs
          const q: Asked = {
            id: event.id,
            words: heard,
            at: heardAt,
            since: clock(),
            closed: false,
            ...(event.offsetMs === undefined ? {} : { offsetMs: event.offsetMs }),
            ...(heardTo === undefined ? {} : { reachedMs: heardTo }),
          }
          heard = []
          heardTo = undefined
          latest = q
          queue = queue.then(() => answer(q)).catch(() => undefined)
          break
        }
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
    /**
     * The talk is being ended: from now on nothing more is asked or answered, even before the
     * supplier confirms the end.
     */
    stop() {
      stopping = true
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
