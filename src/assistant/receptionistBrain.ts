import type { Brain, BrainMessage, ToolCall } from '../../lumane'
import { addDays } from '../domain/format'
import { healthWordIn } from '../domain/forms'
import type { Tone } from '../domain/receptionistSchema'
import { TONE_CHOICES } from './tone'

/**
 * The test-mode brain for the AI receptionist. It understands a few plain guest questions, uses
 * the same skills a real AI would and writes the answer from what they return. No AI supplier is
 * called, so it costs nothing and sends nothing; it lets the fictional studios try the chat.
 */
export function receptionistBrain(
  today: string,
  locale = 'en-GB',
  channel: ReceptionChannel = 'web',
  tone: Tone = 'warm',
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
        : firstStep(talk, offered, today, channel, tone)
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
/** Stands in a text answer for the visit's private link; the outbox mints it as it sends. */
export const MANAGE_LINK_SPOT = '[[manage-link]]'
/** By message the team already has the guest's words and how to answer them in the inbox. */
const TEXT_HANDOVER =
  'I have passed this to the team. Someone will reply to you here as soon as they can.'

// The examples name no treatment, since not every studio offers the same ones.
export const RECEPTION_HELP =
  'I can tell you about our treatments and prices, our opening hours and how to find us, and find you a free time to book. I can also pass a message to the team. Try "what treatments do you offer?" or "any times on Thursday afternoon?"'
/** What the receptionist says when it does not know: it never guesses. */
const NOT_SURE = 'I am not sure about that, so I will not guess.'
/** Offered when it cannot answer, so the guest's next message can be their details. */
const OFFER_TEAM =
  'If you would like, I can pass your question to the team. Tell me your name and an email address or phone number they can answer on.'
const ASK_CONTACT =
  'Of course. What is your name, and an email address or phone number the team can answer on? Then tell me your message.'
const HEALTH =
  'I am an AI, so I cannot help with health or medical questions, and please do not share health details here. The team can talk it through with you.'

const ASK_TREATMENT = 'Which treatment would you like?'
const ASK_WHICH_VISIT = 'Which visit would you like to change?'
/** Only someone writing from the number on a booking can be sent its link. */
const CHANGE_ELSEWHERE_TEXT =
  'I can only send the link to change a visit to the phone number on the booking. Please use the link in your booking confirmation, or text us from that number. The team can see your message and will reply to you here.'
const CHANGE_ELSEWHERE_WEB =
  'I cannot change a visit in this chat. Please use the link in your booking confirmation, or ask me to pass a message to the team.'

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
const WANTS_CHANGE =
  /\b(cancel|cancell?ing|move|moving|change|changing|reschedule|rearrange|postpone|can'?t make|cannot make|can’t make)\b/
/** Opening hours: "are you open on Sunday?", "what time do you close?" */
const WANTS_HOURS = /\b(open|opening|hours|close|closed|closing|shut)\b/
/** A booking word makes it a question about free times, even with "open" in it. */
const BOOKING_WORDS =
  /\b(book|booking|appointment|available|availability|free|slots?|space|any times?|opening for|an opening|openings)\b/
const WANTS_MENU =
  /\b(price|prices|cost|costs|how much|treatments?|menu|services?|offer|do you do)\b/
/** Asking for one thing by name: "do you do nails?" */
const DO_YOU = /\b(do you (do|offer|have)|have you got|can i (get|have|book))\b/
const WHOLE_MENU = /\b(what|which|treatments?|services?|menu|list|anything)\b/
/** A greeting, or asking who is answering: the receptionist says what it is and what it does. */
const GREETING =
  /^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening))\b[^?]*$|\bis (that|this) (the )?(studio|salon|spa)\b/i
const THANKS = /^\s*(thanks|thank you|cheers|lovely|perfect|great)\b[^?]*$/i
/**
 * Finding the studio and arriving: what a guest asks, and the words in an arrival note that answer
 * it. Directions are answered by the address and any note.
 */
const ARRIVAL = {
  parking: { asked: /\b(park|parking|car)\b/, noted: /park/, about: 'parking' },
  transport: {
    asked: /\b(station|tube|bus|buses|train|underground|overground|public transport)\b/,
    noted: /station|tube|bus|train|underground|overground|walk/,
    about: 'getting here by public transport',
  },
  access: {
    asked:
      /\b(wheelchair|accessible|accessibility|step-?free|stairs|steps|lift|elevator|pram|buggy)\b/,
    noted: /wheelchair|accessible|step|stair|lift|ground floor|ramp/,
    about: 'access',
  },
  entrance: {
    asked: /\b(door|entrance|bell|buzzer|which floor|gate)\b/,
    noted: /door|entrance|bell|buzzer|floor|ring|gate|reception/,
    about: 'the way in',
  },
  directions: {
    asked:
      /\b(directions?|get there|get to you|find you|where are you|address|located|whereabouts|postcode)\b/,
    noted: /./,
    about: 'directions',
  },
} as const
type Arrival = keyof typeof ARRIVAL
const arrivalIn = (q: string) =>
  (Object.keys(ARRIVAL) as Arrival[]).find((topic) => ARRIVAL[topic].asked.test(q)) ?? null

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

/**
 * The part of the day a guest asks for, as the earliest start (after) and the start to be before,
 * or null. "Morning", "afternoon", "evening", "lunchtime", "after 5", "before 11am".
 */
export function partOfDay(text: string): { after?: string; before?: string; name: string } | null {
  const q = text.toLowerCase()
  const clock = (hour: number, minutes: number) =>
    `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  const edge = /\b(after|before)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/.exec(q)
  if (edge) {
    let hour = Number(edge[2])
    const minutes = Number(edge[3] ?? 0)
    if (hour > 23 || minutes > 59) return null
    // "After 5" in a salon means the evening, not five in the morning.
    if (edge[4] === 'pm' ? hour < 12 : !edge[4] && hour >= 1 && hour <= 7) hour += 12
    else if (edge[4] === 'am' && hour === 12) hour = 0
    const at = clock(hour, minutes)
    return edge[1] === 'after'
      ? { after: at, name: `after ${at}` }
      : { before: at, name: `before ${at}` }
  }
  if (/\bmorning\b/.test(q)) return { before: '12:00', name: 'morning' }
  if (/\blunch ?time\b|\blunch\b/.test(q))
    return { after: '12:00', before: '14:00', name: 'lunchtime' }
  if (/\bafternoon\b/.test(q)) return { after: '12:00', before: '17:00', name: 'afternoon' }
  if (/\b(evening|tonight|after work)\b/.test(q)) return { after: '17:00', name: 'evening' }
  return null
}
/** "evening times", "times after 17:00". */
const partTimes = (name: string) =>
  /^(after|before) /.test(name) ? `times ${name}` : `${name} times`
/** "in the evening", "at lunchtime", "after 17:00". */
const partPhrase = (name: string) =>
  /^(after|before) /.test(name) ? name : name === 'lunchtime' ? 'at lunchtime' : `in the ${name}`

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

type Place = { id: string; name: string; price: string }
type Treatment = {
  id: string
  name: string
  kind: string
  price: string
  /** With several locations: where it can be booked, and its price there. */
  locations?: Place[]
  professionals: { id: string; name: string }[]
}

const COMMON = new Set(['the', 'and', 'for', 'with', 'our', 'you', 'your', 'her', 'his', 'new'])
/**
 * A short word in a treatment's name, such as "cut", "wax" or "tan": on its own, in the plural,
 * with "-ing" or at the end of a longer word ("haircut"), but not inside one ("cuticle").
 */
const shortWordIn = (q: string, w: string) => new RegExp(`${w}(s|es|\\w?ing)?\\b`).test(q)
/** The treatment the guest means, from the newest thing they said that names one. */
function treatmentIn(talk: Talk, list: Treatment[]) {
  for (const said of talk.guest) {
    const q = said.toLowerCase()
    let best: Treatment | null = null,
      score = 0
    for (const t of list) {
      // Short words count too when they mean something here: "cut", "wax", "tan".
      const words = t.name
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3 || (w.length === 3 && !COMMON.has(w)))
      const hits = words.filter((w) =>
        w.length === 3 ? shortWordIn(q, w) : q.includes(w.replace(/s$/, '')),
      ).length
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
/** A location's own name, before any town after a comma: "Marylebone" for "Marylebone, London". */
const placeWord = (name: string) => name.split(',')[0].trim().toLowerCase()
/** Every location the listed treatments can be booked at. */
const placesOf = (list: Treatment[]) => [
  ...new Map(list.flatMap((t) => t.locations ?? []).map((p) => [p.id, p])).values(),
]
/** The location the guest names, from the newest thing they said that names one. */
function placeIn(talk: Talk, list: Treatment[]) {
  return namedPlace(talk, placesOf(list))
}
function namedPlace<T extends { name: string }>(talk: Talk, known: T[]) {
  if (known.length < 2) return null
  for (const said of talk.guest) {
    const q = said.toLowerCase()
    const named = known.find((p) => placeWord(p.name).length > 2 && q.includes(placeWord(p.name)))
    if (named) return named
  }
  return null
}
const names = (list: { name: string }[]) =>
  list.length < 2
    ? (list[0]?.name ?? '')
    : `${list
        .slice(0, -1)
        .map((p) => p.name)
        .join(', ')} and ${list.at(-1)!.name}`

const firstDate = (talk: Talk, today: string) => {
  for (const said of talk.guest) {
    const date = dateIn(said, today)
    if (date) return date
  }
  return null
}
const firstPart = (talk: Talk) => {
  for (const said of talk.guest) {
    const part = partOfDay(said)
    if (part) return part
  }
  return null
}
/** A clock time the guest names, unless it is the edge of a part of the day ("after 5pm"). */
const exactTime = (said: string) => (/\b(after|before)\s+\d/i.test(said) ? null : timeIn(said))

/** Which of the listed visits the guest means: its number in the list, or its day. */
function visitIn(said: string, visits: { id: string; date: string }[], today: string) {
  const q = said.toLowerCase()
  const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'].findIndex((w) =>
    new RegExp(`\\b${w}\\b`).test(q),
  )
  const number = /^\s*#?(\d)\b/.exec(q)?.[1]
  const index = number ? Number(number) - 1 : ordinal
  if (index >= 0 && index < visits.length) return visits[index]
  const date = dateIn(q, today)
  const onDay = visits.filter((v) => v.date === date)
  return onDay.length === 1 ? onDay[0] : null
}

function intent(talk: Talk) {
  const q = talk.latest.toLowerCase()
  if (healthWordIn(talk.latest)) return 'health'
  // After "I can pass your question to the team", the guest's details answer it.
  if (
    WANTS_PERSON.test(q) ||
    talk.lastAnswer === ASK_CONTACT ||
    talk.lastAnswer.endsWith(OFFER_TEAM)
  )
    return 'person'
  if (WANTS_CHANGE.test(q) || talk.lastAnswer.startsWith(ASK_WHICH_VISIT)) return 'change'
  // Before free times: "are you open on Sunday?" names a day but asks for no booking.
  if (WANTS_HOURS.test(q) && !BOOKING_WORDS.test(q)) return 'hours'
  if (arrivalIn(q)) return 'arrival'
  if (
    WANTS_TIME.test(q) ||
    BOOKING_WORDS.test(q) ||
    timeIn(q) ||
    partOfDay(q) ||
    // "Do you have anything on Saturday?"
    (/\b(any|anything|something)\b/.test(q) && dateIn(q, '2000-01-01')) ||
    (dateIn(q, '2000-01-01') && talk.guest.length > 1) ||
    // A bare treatment name answers "Which treatment would you like?", so the search goes on.
    talk.lastAnswer.startsWith(ASK_TREATMENT)
  )
    return 'time'
  if (WANTS_MENU.test(q)) return 'menu'
  if (GREETING.test(talk.latest)) return 'greeting'
  if (THANKS.test(talk.latest)) return 'thanks'
  return 'unknown'
}

/** When the receptionist cannot answer, the team can. */
function teamCan(offered: Set<string>, channel: ReceptionChannel) {
  if (channel === 'text')
    return 'I have passed your question to the team. Someone will reply to you here as soon as they can.'
  return offered.has('pass_to_team')
    ? OFFER_TEAM
    : 'Please call or email the studio, and the team will help.'
}

function firstStep(
  talk: Talk,
  offered: Set<string>,
  today: string,
  channel: ReceptionChannel,
  tone: Tone,
): Step {
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
    case 'change':
      if (offered.has('my_visits')) return call('my_visits')
      return say(channel === 'text' ? CHANGE_ELSEWHERE_TEXT : CHANGE_ELSEWHERE_WEB)
    case 'hours': {
      const date = dateIn(talk.latest, today)
      return call('studio_info', date ? { date } : {})
    }
    case 'arrival':
      return call('studio_info')
    case 'time':
    case 'menu':
      return call('treatments')
    case 'greeting':
      return say(`${TONE_CHOICES[tone].hello} ${RECEPTION_HELP}`)
    case 'thanks':
      return say(TONE_CHOICES[tone].welcome)
    default:
      return say(`${NOT_SURE} ${teamCan(offered, channel)}`)
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
    const info = last.data as StudioInfo
    return say(
      intent(talk) === 'arrival'
        ? arrivalAnswer(talk, info, offered, channel)
        : hoursAnswer(talk, info),
    )
  }
  if (last.name === 'my_visits') {
    const visits = last.data as { id: string; date: string; summary: string }[]
    if (!visits.length)
      return say(
        'I cannot find a visit still to come booked with this number. The team can see your message and will reply to you here.',
      )
    // Several visits: only the guest's answer to "which visit" picks one.
    const chosen =
      visits.length === 1
        ? visits[0]
        : talk.lastAnswer.startsWith(ASK_WHICH_VISIT)
          ? visitIn(talk.latest, visits, today)
          : null
    if (chosen && offered.has('send_manage_link'))
      return call('send_manage_link', { visitId: chosen.id })
    return say(
      `${ASK_WHICH_VISIT} Reply with its number.\n${visits.map((v, i) => `${i + 1}. ${v.summary}`).join('\n')}`,
    )
  }
  if (last.name === 'send_manage_link')
    return say(
      `Here is the private link for your ${(last.data as { summary: string }).summary}: ${MANAGE_LINK_SPOT} You can move or cancel it there. Please keep it to yourself.`,
    )
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
      times: { time: string; label: string; location?: string }[]
      more: number
      after?: string
      before?: string
      closed: boolean
      openThen: boolean
      closedBy: boolean
      opens: string | null
      closes: string | null
    }
    const named = firstDate(talk, today)
    const tries = results.filter((r) => r.name === 'find_times').length
    // With no day named, look on through the next few days for the first free one. Four looks
    // and the answer fit in the six steps one message may take.
    if (!found.times.length && !named && tries < 4)
      return call('find_times', {
        ...last.input,
        date: addDays(found.date, 1),
      })
    const part = found.after || found.before ? firstPart(talk) : null
    const again = 'Tell me another day or time and I will look again.'
    if (!found.times.length && !named)
      return say(
        `There is nothing free for ${found.treatment}${part ? ` ${partPhrase(part.name)}` : ''} over the next four days. ${again}`,
      )
    if (!found.times.length && found.closed) return say(`We are closed on ${found.day}. ${again}`)
    // Asked for a part of the day the studio is not open: say so, rather than offer another.
    if (!found.times.length && part && !found.openThen)
      return say(
        found.closedBy
          ? `We close at ${found.closes} on ${found.day}, so there are no ${partTimes(part.name)}. ${again}`
          : `We open at ${found.opens} on ${found.day}, so there are no ${partTimes(part.name)}. ${again}`,
      )
    if (!found.times.length)
      return say(
        `There is nothing free for ${found.treatment}${part ? ` ${partPhrase(part.name)}` : ''} on ${found.day}. ${again}`,
      )
    const wanted = exactTime(talk.latest)
    if (wanted && found.times.some((t) => t.time === wanted) && offered.has('offer_time'))
      return call('offer_time', { ...last.input, time: wanted })
    const who = found.professional === 'anyone' ? '' : ` with ${found.professional}`
    const more = found.more ? `, and ${found.more} more` : ''
    // V2: with several locations, say where the times are.
    const sites = [...new Set(found.times.map((t) => t.location ?? ''))]
    if (sites.length > 1) {
      const lines = sites.map(
        (site) =>
          `At ${site}: ${found.times
            .filter((t) => t.location === site)
            .map((t) => t.label)
            .join(', ')}`,
      )
      if (found.more) lines.push(`And ${found.more} more.`)
      return say(
        `${found.treatment}${who} on ${found.day}:\n${lines.join('\n')}\nWhich would you like?`,
      )
    }
    return say(
      `${found.treatment}${who}${sites[0] ? ` at ${sites[0]}` : ''} on ${found.day}: ${found.times
        .map((t) => t.label)
        .join(', ')}${more}. Which would you like?`,
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
      // V2: times at the location the guest names, when it offers the treatment.
      const place = placeIn(talk, list)
      if (place && !chosen.locations?.some((p) => p.id === place.id))
        return say(
          `${chosen.name} is not offered at ${place.name}. You can book it at ${names(chosen.locations ?? [])}.`,
        )
      // Only the part of the day the guest asked for, such as the afternoon or after 5.
      const part = firstPart(talk)
      const input = {
        treatmentId: chosen.id,
        date: firstDate(talk, today) ?? addDays(today, 1),
        ...(person ? { professionalId: person.id } : {}),
        ...(place ? { locationId: place.id } : {}),
      }
      const wanted = exactTime(talk.latest)
      if (wanted && /\bbook\b/i.test(talk.latest) && offered.has('offer_time'))
        return call('offer_time', { ...input, time: wanted })
      return call('find_times', {
        ...input,
        ...(part?.after ? { after: part.after } : {}),
        ...(part?.before ? { before: part.before } : {}),
      })
    }
    // Asked for something by name that is not on the menu: say so, and never suggest another.
    const q = talk.latest.toLowerCase()
    if (!chosen && DO_YOU.test(q) && !WHOLE_MENU.test(q))
      return say(
        `I cannot find that on our menu. We offer ${names(list.slice(0, 8))}. ${teamCan(offered, channel)}`,
      )
    const more = '\nAsk about any of them, or ask me for a free time.'
    // V2: at the location the guest names, only what is offered there, at its price there.
    const place = placeIn(talk, list)
    if (place) {
      const here = (t: Treatment) => t.locations?.find((p) => p.id === place.id)
      if (chosen && !here(chosen))
        return say(
          `${chosen.name} is not offered at ${place.name}. You can book it at ${names(chosen.locations ?? [])}.`,
        )
      if (chosen) return say(`${chosen.name} at ${place.name}: ${here(chosen)!.price}`)
      return say(
        `At ${place.name}:\n${list
          .filter(here)
          .slice(0, 8)
          .map((t) => `${t.name}: ${here(t)!.price}`)
          .join('\n')}${more}`,
      )
    }
    // Otherwise the lowest price, and where a treatment is offered when not everywhere.
    const everywhere = placesOf(list).length
    const line = (t: Treatment) =>
      `${t.name}: ${t.price}${t.locations && t.locations.length < everywhere ? ` Only at ${names(t.locations)}.` : ''}`
    if (chosen && chosen.locations && new Set(chosen.locations.map((p) => p.price)).size > 1)
      return say(
        `${chosen.name}:\n${chosen.locations.map((p) => `At ${p.name}: ${p.price}`).join('\n')}`,
      )
    const shown = chosen ? [chosen] : list.slice(0, 8)
    return say(`${shown.map(line).join('\n')}${chosen ? '' : more}`)
  }
  return say(`${NOT_SURE} ${teamCan(offered, channel)}`)
}

type Site = {
  id: string
  name: string
  address: string | null
  arrivalNote: string | null
  hours: { day: string; open: string }[]
}
type StudioInfo = {
  name: string
  address: string | null
  arrivalNote: string | null
  hours: { day: string; open: string }[]
  closedDays: string[]
  changedDays: string[]
  locations?: Site[]
  on?: { date: string; day: string; places: { id: string; name: string; open: string[] }[] }
}

/** Opening hours: on the day asked about, after any closure, or the usual week. */
function hoursAnswer(talk: Talk, info: StudioInfo) {
  const named = namedPlace(talk, info.locations ?? [])
  if (info.on) {
    const { day } = info.on
    const spans = (open: string[]) => open.join(' and ')
    if (named) {
      const site = info.on.places.find((p) => p.id === named.id)!
      return site.open.length
        ? `On ${day}, ${site.name} is open ${spans(site.open)}.`
        : `${site.name} is closed on ${day}.`
    }
    const sites = info.on.places
    if (sites.every((p) => !p.open.length)) return `We are closed on ${day}.`
    if (sites.length === 1) return `On ${day} we are open ${spans(sites[0].open)}.`
    return `On ${day}:\n${sites.map((p) => `${p.name}: ${p.open.length ? spans(p.open) : 'Closed'}`).join('\n')}`
  }
  // The usual week: one list when every location keeps the same hours.
  const sites = named ? [named] : (info.locations ?? [])
  const same = sites.every((site) => JSON.stringify(site.hours) === JSON.stringify(info.hours))
  const week = (title: string, hours: StudioInfo['hours']) => [
    `${title} is open:`,
    ...hours.map((h) => `${h.day}: ${h.open}`),
  ]
  return [
    ...(named
      ? week(named.name, named.hours)
      : same
        ? week(info.name, info.hours)
        : sites.flatMap((site) => week(site.name, site.hours))),
    info.closedDays.length ? `Closed on ${info.closedDays.join(', ')}.` : '',
    info.changedDays.length ? `Different hours on ${info.changedDays.join(', ')}.` : '',
    named?.address
      ? `You will find ${named.name} at ${named.address}.`
      : !info.locations && info.address
        ? `You will find us at ${info.address}.`
        : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Finding the studio and arriving: the address, and the arrival note when it covers what was
 * asked. Otherwise it says plainly that it does not know, and the team can answer.
 */
function arrivalAnswer(
  talk: Talk,
  info: StudioInfo,
  offered: Set<string>,
  channel: ReceptionChannel,
) {
  const topic = arrivalIn(talk.latest.toLowerCase()) ?? 'directions'
  const all: Omit<Site, 'hours'>[] = info.locations ?? [
    { id: '', name: info.name, address: info.address, arrivalNote: info.arrivalNote },
  ]
  const named = namedPlace(talk, info.locations ?? [])
  const sites = named ? [named] : all
  const several = sites.length > 1
  const addresses = sites
    .filter((site) => site.address)
    .map((site) =>
      several
        ? `${site.name}: ${site.address}`
        : `You will find ${named ? site.name : 'us'} at ${site.address}.`,
    )
  const notes = sites
    .filter((site) => site.arrivalNote && ARRIVAL[topic].noted.test(site.arrivalNote.toLowerCase()))
    .map((site) => `${several ? `${site.name}: ` : ''}${site.arrivalNote}`)
  if (notes.length) return [...notes, ...addresses].join('\n')
  if (topic === 'directions' && addresses.length) return addresses.join('\n')
  return [
    `I do not know about ${ARRIVAL[topic].about}.`,
    ...addresses,
    teamCan(offered, channel),
  ].join(several ? '\n' : ' ')
}
