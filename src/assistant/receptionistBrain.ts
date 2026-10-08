import type { Brain, BrainMessage, ToolCall } from '../../lumane'
import { addDays } from '../domain/format'
import { healthWordIn } from '../domain/forms'

/**
 * The test-mode brain for the AI receptionist. It understands a few plain guest questions, uses
 * the same skills a real AI would and writes the answer from what they return. No AI supplier is
 * called, so it costs nothing and sends nothing; it lets the fictional studios try the chat.
 */
export function receptionistBrain(
  today: string,
  locale = 'en-GB',
  channel: ReceptionChannel = 'web',
): Brain {
  void locale
  return {
    name: 'test-mode',
    async respond(request) {
      const talk = conversation(request.messages)
      const results = toolResults(request.messages)
      const offered = new Set(request.tools.map((t) => t.name))
      const step = results.length
        ? nextStep(talk, results, offered, today, channel)
        : firstStep(talk, offered, today, channel)
      return { ...step, costMinor: 0 }
    },
  }
}

/**
 * Where the guest is talking: the booking page's chat, or (`text`) a message to the studio's text
 * line, Instagram, Facebook or WhatsApp, where there is no page around the answer.
 */
export type ReceptionChannel = 'web' | 'text'
/** Stands in a text answer for the link that books an offered time; the server fills it in. */
export const BOOKING_LINK = '[[booking-link]]'
/** By message the team already has the guest's words and how to answer them in the inbox. */
const TEXT_HANDOVER =
  'I have passed this to the team. Someone will reply to you here as soon as they can.'

export const RECEPTION_HELP =
  'I can tell you about our treatments and prices, our opening hours, and find you a free time to book. I can also pass a message to the team. Try "how much is a facial?" or "any times on Thursday for a haircut?"'
const ASK_CONTACT =
  'Of course. What is your name, and an email address or phone number the team can answer on? Then tell me your message.'
const HEALTH =
  'I am an AI, so I cannot help with health or medical questions, and please do not share health details here. The team can talk it through with you.'

const ASK_TREATMENT = 'Which treatment would you like?'

type Step = { text?: string; calls: ToolCall[] }
type Result = { name: string; input: Record<string, unknown>; ok: boolean; data: unknown }
type Talk = { latest: string; guest: string[]; lastAnswer: string }

let counter = 0
const call = (name: string, input: Record<string, unknown> = {}): Step => ({
  calls: [{ id: `reception-${++counter}`, name, input }],
})
const say = (text: string): Step => ({ text, calls: [] })

/** What the guest has said in this chat, newest first, and the receptionist's last answer. */
function conversation(messages: BrainMessage[]): Talk {
  const guest = messages
    .filter((m): m is Extract<BrainMessage, { role: 'user' }> => m.role === 'user')
    .map((m) => m.text.trim())
    .reverse()
  const latestAt = messages.map((m) => m.role).lastIndexOf('user')
  const lastAnswer =
    messages
      .slice(0, latestAt)
      .filter((m) => m.role === 'assistant' && m.text)
      .map((m) => (m.role === 'assistant' ? (m.text ?? '') : ''))
      .at(-1) ?? ''
  return { latest: guest[0] ?? '', guest, lastAnswer }
}

function toolResults(messages: BrainMessage[]): Result[] {
  const start = messages.map((m) => m.role).lastIndexOf('user')
  const calls = new Map<string, ToolCall>()
  const results: Result[] = []
  for (const m of messages.slice(start + 1)) {
    if (m.role === 'assistant') for (const c of m.calls) calls.set(c.id, c)
    if (m.role === 'tool') {
      const made = calls.get(m.callId)
      if (!made) continue
      let data: unknown = m.result
      try {
        data = JSON.parse(m.result)
      } catch {
        // A refusal is plain text.
      }
      results.push({
        name: made.name,
        input: made.input as Record<string, unknown>,
        ok: !m.isError,
        data,
      })
    }
  }
  return results
}

const WANTS_PERSON =
  /\b(person|human|someone|somebody|staff|the team|call me|call back|ring me|speak|talk to|leave a message|message the|contact)\b/
const WANTS_TIME =
  /\b(book|booking|appointment|available|availability|free|slots?|times?|when can|space|opening for)\b/
const WANTS_HOURS =
  /\b(open|opening hours|hours|close|closed|closing|address|where are you|located|location|find you)\b/
const WANTS_MENU =
  /\b(price|prices|cost|costs|how much|treatments?|menu|services?|offer|do you do)\b/

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** The date a guest means, or null when they named none. */
export function dateIn(text: string, today: string): string | null {
  const q = text.toLowerCase()
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(q)
  if (iso) return iso[1]
  if (/\btoday\b/.test(q)) return today
  if (/\btomorrow\b/.test(q)) return addDays(today, 1)
  const month = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})\\b|\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
  ).exec(q)
  if (month) {
    const dayOf = Number(month[1] ?? month[4])
    const monthOf = MONTHS.indexOf(month[2] ?? month[3]) + 1
    const year = Number(today.slice(0, 4))
    const pad = (n: number) => String(n).padStart(2, '0')
    const on = (y: number) => `${y}-${pad(monthOf)}-${pad(dayOf)}`
    const date = on(year) < today ? on(year + 1) : on(year)
    // A date that does not exist, such as 31 February, is no date at all.
    const real = new Date(`${date}T12:00:00Z`)
    return !Number.isNaN(real.getTime()) && real.toISOString().slice(0, 10) === date ? date : null
  }
  const named = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(q))
  if (named < 0) return null
  const current = new Date(`${today}T12:00:00Z`).getUTCDay()
  return addDays(today, (named - current + 7) % 7)
}

/** A clock time the guest names, as HH:MM, or null. "10am", "2.30pm", "14:00", "at 3". */
export function timeIn(text: string): string | null {
  const q = text.toLowerCase()
  const m =
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/.exec(q) ??
    /\b(\d{1,2})[:.](\d{2})\b/.exec(q) ??
    /\bat (\d{1,2})\b/.exec(q)
  if (!m) return null
  let hour = Number(m[1])
  const minutes = Number(m[2] ?? 0)
  if (hour > 23 || minutes > 59) return null
  if (m[3] === 'pm' && hour < 12) hour += 12
  else if (m[3] === 'am' && hour === 12) hour = 0
  else if (!m[3] && hour >= 1 && hour <= 7) hour += 12
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** An email address or phone number in what the guest wrote. */
function contactIn(text: string) {
  return (
    /[^\s@,;]+@[^\s@,;]+\.[^\s@,;.]+/.exec(text)?.[0] ??
    /(?:\+\d[\d\s-]{8,16}\d|\b0\d[\d\s-]{8,12}\d)/.exec(text)?.[0].replace(/\s+/g, ' ') ??
    null
  )
}
function nameIn(text: string) {
  return (
    /\b(?:[Mm]y name is|I am|I'm|I’m|[Tt]his is|[Ii]t's)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/.exec(
      text,
    )?.[1] ?? null
  )
}

type Treatment = {
  id: string
  name: string
  kind: string
  price: string
  professionals: { id: string; name: string }[]
}

/** The treatment the guest means, from the newest thing they said that names one. */
function treatmentIn(talk: Talk, list: Treatment[]) {
  for (const said of talk.guest) {
    const q = said.toLowerCase()
    let best: Treatment | null = null,
      score = 0
    for (const t of list) {
      const words = t.name
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3)
      const hits = words.filter((w) => q.includes(w.replace(/s$/, ''))).length
      if (hits > score) [best, score] = [t, hits]
    }
    if (best) return best
    const kinds = list.filter((t) => q.includes(t.kind.toLowerCase()))
    if (kinds.length === 1) return kinds[0]
  }
  return null
}
function professionalIn(talk: Talk, t: Treatment) {
  for (const said of talk.guest) {
    const q = said.toLowerCase()
    const person = t.professionals.find((p) => q.includes(p.name.toLowerCase().split(' ')[0]))
    if (person) return person
  }
  return null
}
const firstDate = (talk: Talk, today: string) => {
  for (const said of talk.guest) {
    const date = dateIn(said, today)
    if (date) return date
  }
  return null
}

function intent(talk: Talk) {
  const q = talk.latest.toLowerCase()
  if (healthWordIn(talk.latest)) return 'health'
  if (WANTS_PERSON.test(q) || talk.lastAnswer === ASK_CONTACT) return 'person'
  if (
    WANTS_TIME.test(q) ||
    timeIn(q) ||
    (dateIn(q, '2000-01-01') && talk.guest.length > 1) ||
    // A bare treatment name answers "Which treatment would you like?", so the search goes on.
    talk.lastAnswer.startsWith(ASK_TREATMENT)
  )
    return 'time'
  if (WANTS_HOURS.test(q)) return 'hours'
  if (WANTS_MENU.test(q)) return 'menu'
  return 'other'
}

function firstStep(
  talk: Talk,
  offered: Set<string>,
  today: string,
  channel: ReceptionChannel,
): Step {
  void today
  switch (intent(talk)) {
    case 'health':
      if (channel === 'text')
        return say(`${HEALTH} They can see your message and will reply to you here.`)
      return say(
        offered.has('pass_to_team')
          ? `${HEALTH} If you would like, I can pass them a message: tell me your name and an email or phone number.`
          : HEALTH,
      )
    case 'person': {
      if (channel === 'text') return say(TEXT_HANDOVER)
      if (!offered.has('pass_to_team'))
        return say('I cannot pass on messages here. Please call or email the studio.')
      const everything = talk.guest.join('\n')
      const contact = contactIn(everything)
      const name = nameIn(everything)
      if (!contact || !name) return say(ASK_CONTACT)
      // The guest's words, without the contact details they gave.
      const message =
        talk.guest
          .map((said) =>
            said.replace(contact, '').replace(/\b(my name is|i am|i'm)\s+\S+(\s+\S+)?/i, ''),
          )
          .map((said) => said.trim().replace(/^[,.\s]+|[,.\s]+$/g, ''))
          .filter((said) => said.length > 3)
          .reverse()
          .join(' ')
          .slice(0, 1000) || 'Please get in touch.'
      return call('pass_to_team', { name, contact, message })
    }
    case 'hours':
      return call('studio_info')
    case 'time':
    case 'menu':
      return call('treatments')
    default:
      return say(`Hello, I am the studio's AI receptionist. ${RECEPTION_HELP}`)
  }
}

function nextStep(
  talk: Talk,
  results: Result[],
  offered: Set<string>,
  today: string,
  channel: ReceptionChannel,
): Step {
  const last = results.at(-1)!
  if (!last.ok) {
    if (last.name === 'offer_time' || last.name === 'find_times')
      return say(`${String(last.data)} Tell me another day or time and I will look again.`)
    return say(String(last.data))
  }
  if (last.name === 'studio_info') {
    const info = last.data as {
      name: string
      address: string | null
      hours: { day: string; open: string }[]
      closedDays: string[]
    }
    return say(
      [
        `${info.name} is open:`,
        ...info.hours.map((h) => `${h.day}: ${h.open}`),
        info.closedDays.length ? `Closed on ${info.closedDays.join(', ')}.` : '',
        info.address ? `You will find us at ${info.address}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  if (last.name === 'pass_to_team')
    return say(
      'Here is your message. Tap “Send to the team” and they will answer you. Nothing is sent until you do.',
    )
  if (last.name === 'offer_time' && channel === 'text')
    return say(
      `Here it is: ${(last.data as { summary: string }).summary}. Book it here: ${BOOKING_LINK} Nothing is booked until you confirm on that page.`,
    )
  if (last.name === 'offer_time')
    return say(
      'Here it is. Tap “Choose this time” to finish booking with your details. Nothing is booked until you confirm.',
    )
  if (last.name === 'find_times') {
    const found = last.data as {
      treatment: string
      professional: string
      date: string
      day: string
      times: { time: string; label: string }[]
      more: number
    }
    const named = firstDate(talk, today)
    const tries = results.filter((r) => r.name === 'find_times').length
    // With no day named, look on through the week for the first free one.
    if (!found.times.length && !named && tries < 5)
      return call('find_times', {
        ...last.input,
        date: addDays(found.date, 1),
      })
    if (!found.times.length)
      return say(
        `There is nothing free for ${found.treatment} on ${found.day}. Tell me another day and I will look again.`,
      )
    const wanted = timeIn(talk.latest)
    if (wanted && found.times.some((t) => t.time === wanted) && offered.has('offer_time'))
      return call('offer_time', { ...last.input, time: wanted })
    return say(
      `${found.treatment}${found.professional === 'anyone' ? '' : ` with ${found.professional}`} on ${found.day}: ${found.times
        .map((t) => t.label)
        .join(', ')}${found.more ? `, and ${found.more} more` : ''}. Which would you like?`,
    )
  }
  if (last.name === 'treatments') {
    const list = last.data as Treatment[]
    if (!list.length) return say('There are no treatments to book online just now.')
    const chosen = treatmentIn(talk, list)
    if (intent(talk) === 'time') {
      if (!chosen)
        return say(
          `${ASK_TREATMENT} We offer ${list
            .slice(0, 8)
            .map((t) => t.name)
            .join(', ')}.`,
        )
      const person = professionalIn(talk, chosen)
      const input = {
        treatmentId: chosen.id,
        date: firstDate(talk, today) ?? addDays(today, 1),
        ...(person ? { professionalId: person.id } : {}),
      }
      const wanted = timeIn(talk.latest)
      if (wanted && /\bbook\b/i.test(talk.latest) && offered.has('offer_time'))
        return call('offer_time', { ...input, time: wanted })
      return call('find_times', input)
    }
    const shown = chosen ? [chosen] : list.slice(0, 8)
    return say(
      `${shown.map((t) => `${t.name}: ${t.price}`).join('\n')}${chosen ? '' : '\nAsk about any of them, or ask me for a free time.'}`,
    )
  }
  return say(RECEPTION_HELP)
}
