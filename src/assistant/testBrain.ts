import type { Brain, BrainMessage, BrainRequest, ToolCall } from '../../lumane'
import { addDays, dateLabel } from '../domain/format'

/**
 * The test-mode brain for Ask Saleane. It recognises a few plain questions, uses the same skills
 * a real AI would, and writes the answer from what they return. No AI supplier is called, so it
 * costs nothing and sends nothing; it lets the fictional studios try the assistant end to end.
 */
export function testModeBrain(today: string, locale = 'en-GB'): Brain {
  const day = (date: string) => dateLabel(date, locale)
  return {
    name: 'test-mode',
    async respond(request) {
      const results = toolResults(request.messages)
      const offered = new Set(request.tools.map((t) => t.name))
      if (!results.length)
        return { ...firstStep(lastQuestion(request), today, offered), costMinor: 0 }
      return { ...nextStep(lastQuestion(request), results, offered, day, today), costMinor: 0 }
    },
  }
}

const HELP =
  'In test mode I can answer a few things from your records: your morning brief, anything unusual, who is drifting away, what is on today or tomorrow, who is at a time ("who\'s my 10 o\'clock?"), who is on the waitlist, who is due back, takings, money owed, plans running low, low stock, and a brief on a client ("tell me about Maya"). I can prepare changes for you to approve: "book Jamie with Maya for a facial on Thursday at 3pm", "cancel Nina Patel", "Theo is off sick today", "offer Thursday at 2pm to Priya", a reminder ("remind me on Friday to call the supplier"), or an invitation ("invite Maya back"). Owners and managers can also ask "how did we do today?", "how was the week?", and for specials to run.'

const MANAGERS_ONLY = 'That is for owners and managers.'

type Step = { text?: string; calls: ToolCall[] }
type Result = { name: string; input: Record<string, unknown>; ok: boolean; data: unknown }

/**
 * The question being asked. A short follow-up ("and tomorrow?", "and after her?") is read against
 * the conversation so far, the way a person would understand it.
 */
function lastQuestion(request: BrainRequest) {
  const { messages } = request
  const latestAt = messages.map((m) => m.role).lastIndexOf('user')
  const latest = messages[latestAt]?.role === 'user' ? messages[latestAt].text.trim() : ''
  const earlier = messages.slice(0, latestAt)
  const before = earlier.filter((m) => m.role === 'user').at(-1)
  const answer = earlier.filter((m) => m.role === 'assistant' && m.text).at(-1)
  const q = latest.toLowerCase()
  if (!before || before.role !== 'user' || !/^(and|what about|how about)\b/.test(q)) return latest
  if (/\btomorrow\b/.test(q))
    return `${before.text.replace(/\btoday\b/gi, '').replace(/[?.!\s]+$/, '')} tomorrow?`
  if (/\b(after|next)\b/.test(q) && answer?.role === 'assistant') {
    const next = /has [A-Z][\w' -]+? at (\d{2}:\d{2})/.exec(answer.text ?? '')
    if (next) return `Who's at ${next[1]}?`
  }
  return latest
}

/** The skill calls since the latest question, paired with what each returned. */
function toolResults(messages: BrainMessage[]): Result[] {
  const start = messages.map((m) => m.role).lastIndexOf('user')
  const calls = new Map<string, ToolCall>()
  const results: Result[] = []
  for (const m of messages.slice(start + 1)) {
    if (m.role === 'assistant') for (const c of m.calls) calls.set(c.id, c)
    if (m.role === 'tool') {
      const call = calls.get(m.callId)
      if (!call) continue
      let data: unknown = m.result
      try {
        data = JSON.parse(m.result)
      } catch {
        // A refusal is plain text.
      }
      results.push({
        name: call.name,
        input: call.input as Record<string, unknown>,
        ok: !m.isError,
        data,
      })
    }
  }
  return results
}

let counter = 0
const call = (name: string, input: Record<string, unknown> = {}): Step => ({
  calls: [{ id: `test-${++counter}`, name, input }],
})
const say = (text: string): Step => ({ text, calls: [] })

/** Words after "about", "invite", "message" and so on: the client the person means. */
function clientName(question: string) {
  const match =
    /(?:about|invite|brief (?:on|for)|message|text|email|who is|remind)\s+([a-z][a-z' -]{1,60}?)(?:\s+(?:back|to|in|for|again)\b|[?.!]|$)/i.exec(
      question,
    )
  const found = match?.[1].trim()
  return found && !NOT_NAMES.test(found) ? found : undefined
}

const ABSENT =
  /(\boff sick\b|\bis off\b|'s off\b|\bis (sick|ill|unwell)\b|\bnot coming in\b|\bcan'?t come in\b|\bcalled in sick\b)/

/** A clock time in the question, in minutes after midnight: "10 o'clock", "2pm", "at 3", "14:30". */
function clockTime(q: string) {
  const m =
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|o'?clock)\b/.exec(q) ??
    /\bat (\d{1,2})(?:[:.](\d{2}))?\b/.exec(q) ??
    /\b(\d{1,2})[:.](\d{2})\b/.exec(q)
  if (!m) return null
  let hour = Number(m[1])
  const minutes = Number(m[2] ?? 0)
  if (hour > 23 || minutes > 59) return null
  if (m[3] === 'pm' && hour < 12) hour += 12
  else if (m[3] === 'am' && hour === 12) hour = 0
  else if (m[3] !== 'am' && hour >= 1 && hour <= 7) hour += 12
  return hour * 60 + minutes
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** The day the question means: today, tomorrow, or the next named weekday. */
function dayIn(q: string, today: string) {
  if (/\btomorrow\b/.test(q)) return addDays(today, 1)
  const named = WEEKDAYS.findIndex((d) => q.includes(d))
  if (named < 0) return today
  const current = new Date(`${today}T12:00:00Z`).getUTCDay()
  return addDays(today, (named - current + 7) % 7 || 7)
}

/** "Book Jamie in with Maya…": the client named after "book". */
function bookingName(question: string) {
  return /^\s*book\s+([a-z][a-z' -]{1,60}?)\s+(?:in\b|for\b|with\b)/i.exec(question)?.[1].trim()
}

/** "Cancel Emily's 2pm" or "cancel Jamie Morgan": the client named after "cancel". */
function cancelName(question: string) {
  const found =
    /^\s*cancel\s+([a-z][a-z' -]{1,60}?)(?:'s\b|\s+(?:visit|appointment|booking|for|at|on|because)\b|[?.!]|$)/i
      .exec(question)?.[1]
      .trim()
  return found && !NOT_NAMES.test(found) ? found : undefined
}

const NOT_NAMES = /^(today|tomorrow|this|the|my|our|us|me|due|it|that)\b/i

function firstStep(question: string, today: string, offered: Set<string>): Step {
  const q = question.toLowerCase()
  const need = (skill: string, step: Step) => (offered.has(skill) ? step : say(MANAGERS_ONLY))
  const at = clockTime(q)
  if (/^\s*book\b/.test(q) && bookingName(question))
    return offered.has('book_visit')
      ? {
          calls: [
            ...call('find_client', { name: bookingName(question)! }).calls,
            ...call('catalogue').calls,
          ],
        }
      : say('Your role cannot book visits.')
  if (/^\s*cancel\b/.test(q) && cancelName(question))
    return offered.has('cancel_visit')
      ? call('find_client', { name: cancelName(question)! })
      : say('Your role cannot cancel visits.')
  if (/^\s*(please\s+)?remind (me|us|the team)\b/.test(q)) {
    const text = reminderText(question)
    if (!text) return say('What should I remind you about? Say "remind me on Friday to…".')
    return offered.has('add_reminder')
      ? call('add_reminder', { text, dueDate: dayIn(q, today) })
      : say('Your role cannot leave reminders.')
  }
  if (/\b(reminders?|to-?dos?|to do list)\b/.test(q))
    return offered.has('reminders') ? call('reminders') : say('Your role cannot see reminders.')
  if (/\b(wait ?list|waiting list)\b/.test(q) || /^\s*offer\b/.test(q))
    return offered.has('waitlist_matches')
      ? call('waitlist_matches')
      : say('Your role cannot see the waitlist.')
  if (ABSENT.test(q) && !/^\s*(book|cancel)\b/.test(q))
    return need('cover_absence', call('catalogue'))
  if (/\b(how did we do|close (the|my) day|end of (the )?day|wrap up|today go)\b/.test(q))
    return need('day_recap', call('day_recap'))
  if (/\b(week|weekly)\b/.test(q) && /\b(how|review|was|why|quiet|go)\b/.test(q))
    return need('week_review', call('week_review'))
  if (at !== null && /\b(my|who'?s|who is|at)\b/.test(q) && !/\bbook\b/.test(q))
    return call('visit_at', { time: at, date: /\btomorrow\b/.test(q) ? addDays(today, 1) : today })
  if (/\b(invite|draft|message|text|email)\b/.test(q) && clientName(question))
    return offered.has('draft_message')
      ? call('find_client', { name: clientName(question)! })
      : say('Your role cannot prepare messages.')
  if (/\b(specials?|deals?|promotions?|promos?|seasonal|season|events?|occasions?)\b/.test(q)) {
    if (/\b(work|worked|working|results?|how did|going|went)\b/.test(q))
      return need('special_results', call('special_results'))
    return need('special_ideas', call('special_ideas'))
  }
  if (/\b(brief|summary|morning|overview)\b/.test(q) && !clientName(question))
    return {
      calls: [
        ...call('morning_brief').calls,
        ...call('unusual').calls,
        ...(offered.has('reminders') ? call('reminders').calls : []),
      ],
    }
  if (/\b(unusual|warning|warnings|worry|wrong|odd|problems?)\b/.test(q)) return call('unusual')
  if (/\b(drifting|slipping|lost|losing|lapsing|missing)\b/.test(q)) return call('drifting_clients')
  if (/\btomorrow\b/.test(q)) return call('day_overview', { date: addDays(today, 1) })
  if (/\b(today|on today|my day|diary|schedule|day look)\b/.test(q)) return call('day_overview')
  if (/\b(due back|due|lapsed|haven't been|not been|fill|gap|quiet)\b/.test(q))
    return call('due_back')
  if (/\b(owe|owes|owed|owing|balance|outstanding)\b/.test(q)) return call('money_owed')
  if (/\b(plan|plans|package|packages|membership|memberships)\b/.test(q))
    return call('plans_running_low')
  if (/\b(stock|reorder|products?)\b/.test(q)) return need('low_stock', call('low_stock'))
  if (/\b(takings|take|took|revenue|earn|made|sales|money)\b/.test(q)) {
    const days = /\bmonth\b/.test(q) ? 30 : /\bweek\b/.test(q) ? 7 : 1
    return need('takings', call('takings', { days }))
  }
  if (/\b(about|brief|who is)\b/.test(q) && clientName(question))
    return call('find_client', { name: clientName(question)! })
  return say(HELP)
}

function nextStep(
  question: string,
  results: Result[],
  offered: Set<string>,
  day: (date: string) => string,
  today: string,
): Step {
  const last = results[results.length - 1]
  if (!last.ok) return say(String(last.data))
  const flow = managerFlow(question, results, day, today)
  if (flow) return flow
  const brief = results.find((r) => r.name === 'morning_brief')
  if (brief?.ok) {
    const notices = results.find((r) => r.name === 'unusual')
    const reminders = results.find((r) => r.name === 'reminders')
    return say(
      [
        describeMorning(brief.data as Morning, day),
        describeNotices(notices?.data as Notice[]),
        reminders?.ok ? describeReminders(reminders.data as Reminders, true) : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }
  const q = question.toLowerCase()
  switch (last.name) {
    case 'find_client': {
      const found = last.data as { clientId: string; name: string }[]
      if (!found.length) return say(`I could not find a client called ${String(last.input.name)}.`)
      if (found.length > 1)
        return say(
          `I found ${found.length} clients: ${found.map((c) => c.name).join(', ')}. Which one do you mean?`,
        )
      return call('client_brief', { clientId: found[0].clientId })
    }
    case 'client_brief': {
      const brief = last.data as Brief
      const wantsDraft = /\b(invite|draft|message|text|email)\b/.test(q)
      if (wantsDraft && offered.has('draft_message')) {
        const first = brief.name.split(' ')[0]
        return call('draft_message', {
          clientId: String(last.input.clientId),
          purpose: 'marketing',
          subject: `We'd love to see you again, ${first}`,
          body: `Hello ${first}, it has been a little while since your last visit. If you would like to come back, reply to this message or book online whenever suits you.`,
        })
      }
      return say(describeBrief(brief, day))
    }
    case 'special_ideas': {
      const ideas = last.data as Idea[]
      const wanted = /\b(plan|run|set up|start|go with)\b/.test(q) && pickIdea(q, ideas)
      if (wanted && offered.has('plan_special'))
        return call('plan_special', { signalId: wanted.signalId })
      if (!ideas.length) return say('Nothing coming up needs a special right now.')
      const lines = ideas
        .slice(0, 3)
        .map(
          (g) =>
            `${g.title} (${day(g.from)} to ${day(g.to)}): ${g.reason} ${g.room} Idea: ${g.idea}`,
        )
      return say(
        `Specials to consider. ${lines.join(' ')} Say "plan the" and its name and I will prepare it for you to approve.`,
      )
    }
    case 'waitlist_matches': {
      const list = last.data as Waiting[]
      if (/^\s*offer\b/.test(q) && offered.has('offer_from_waitlist')) {
        const entry = list.find((e) => q.includes(e.client.split(' ')[0].toLowerCase()))
        if (!entry)
          return say(
            list.length
              ? `Who should I offer it to? Waiting: ${list.map((e) => e.client).join(', ')}.`
              : 'Nobody is on the waitlist right now.',
          )
        const at = clockTime(q)
        const date =
          /\btomorrow\b/.test(q) || WEEKDAYS.some((d) => q.includes(d)) ? dayIn(q, today) : null
        const opening = entry.openings.find(
          (o) => (at === null || o.startMinutes === at) && (!date || o.date === date),
        )
        if (!opening)
          return say(
            `That time is not free for ${entry.client}'s ${entry.service}.${entry.openings.length ? ` Free: ${entry.openings.map((o) => `${day(o.date)} at ${o.time} with ${firstName(o.professional)}`).join('; ')}.` : ''}`,
          )
        return call('offer_from_waitlist', {
          entryId: entry.entryId,
          date: opening.date,
          startMinutes: opening.startMinutes,
          staffId: opening.staffId,
        })
      }
      if (!list.length) return say('Nobody is on the waitlist right now.')
      const lines = list.slice(0, 5).map((e) => {
        const who = e.professional ? ` with ${firstName(e.professional)}` : ''
        const free = e.openings[0]
          ? `first free ${day(e.openings[0].date)} at ${e.openings[0].time} with ${firstName(e.openings[0].professional)}`
          : 'nothing free yet'
        return `${e.client}, ${e.service}${who}, ${e.suits} (${free})`
      })
      return say(
        `${list.length} waiting: ${lines.join('; ')}. Say "offer" with a name and a time and I will write the offer for you to approve.`,
      )
    }
    case 'reminders':
      return say(
        describeReminders(last.data as Reminders, false) || 'You have no reminders waiting.',
      )
    case 'add_reminder':
      return say('I have prepared the reminder below. Approve it to save it; nothing is sent.')
    case 'offer_from_waitlist':
      return say(
        'I have written the offer below. Approve it to save it in the Inbox for a final look; nothing has gone to the client yet.',
      )
    case 'plan_special':
      return say(
        'I have prepared the special below. Approve it to plan it. Nothing is sent and no prices change; you tell clients from the Inbox.',
      )
    case 'special_results': {
      const list = last.data as { title: string; result: string }[]
      if (!list.length) return say('You have no specials planned. Ask me for ideas.')
      return say(list.map((r) => `${r.title}: ${r.result}`).join(' '))
    }
    case 'draft_message':
      return say(
        'I have prepared the invitation below. Nothing has been sent: approve it to save it as an unsent draft in the Inbox.',
      )
    case 'unusual':
      return say(describeNotices(last.data as Notice[]) || 'Nothing looks unusual right now.')
    case 'drifting_clients': {
      const list = last.data as Drifting[]
      if (!list.length) return say('Nobody is drifting away right now.')
      const lines = list.slice(0, 5).map((d) => {
        const usual = d.usualWeeks ? `, usually every ${d.usualWeeks}` : ''
        const offer = d.openTime
          ? `; ${d.openTime.professional} is free ${day(d.openTime.date)} at ${d.openTime.time}`
          : ''
        return `${d.name} (${d.weeksSince} weeks${usual}${offer})`
      })
      return say(
        `${list.length} ${list.length === 1 ? 'client is' : 'clients are'} drifting away: ${lines.join('; ')}. Say "invite" and a name and I will prepare a message.`,
      )
    }
    case 'day_overview':
      return say(describeDay(last.data as Day, day))
    case 'due_back': {
      const due = last.data as { name: string; lastVisit?: string; marketingConsent: boolean }[]
      if (!due.length)
        return say('Nobody is due back right now. Your regulars all have something booked.')
      const list = due
        .slice(0, 6)
        .map(
          (c) =>
            `${c.name} (last visit ${c.lastVisit ? day(c.lastVisit) : 'an unknown date'}${c.marketingConsent ? '' : ', no marketing'})`,
        )
      return say(
        `${due.length} ${due.length === 1 ? 'regular is' : 'regulars are'} due back: ${list.join('; ')}. Say "invite" and a name and I will prepare a message.`,
      )
    }
    case 'takings': {
      const t = last.data as {
        takings: string
        tips: string
        completedVisits: number
        rebookRate: string | null
        topService: string | null
        from: string
        to: string
      }
      const span = last.input.days === 1 ? 'Today' : `In the last ${String(last.input.days)} days`
      return say(
        `${span}: ${t.takings} in service takings${/[1-9]/.test(t.tips) ? ` and ${t.tips} in tips` : ''}, from ${t.completedVisits} completed ${t.completedVisits === 1 ? 'visit' : 'visits'}.${t.rebookRate ? ` ${t.rebookRate} rebooked.` : ''}${t.topService ? ` ${t.topService} earned the most.` : ''}`,
      )
    }
    case 'money_owed': {
      const owed = last.data as { client: string; amount: string }[]
      if (!owed.length) return say('No client owes the studio anything.')
      return say(`Still owed: ${owed.map((o) => `${o.client} ${o.amount}`).join('; ')}.`)
    }
    case 'plans_running_low': {
      const low = last.data as { client: string; plan: string; visitsLeft: number }[]
      if (!low.length) return say('No package or membership is running low.')
      return say(
        `Running low: ${low.map((p) => `${p.client}, ${p.plan} (${p.visitsLeft} left)`).join('; ')}.`,
      )
    }
    case 'low_stock': {
      const low = last.data as { product: string; inStock: number; reorderAt: number }[]
      if (!low.length) return say('Nothing is at its reorder level.')
      return say(
        `Time to reorder: ${low.map((p) => `${p.product} (${p.inStock} left, reorder at ${p.reorderAt})`).join('; ')}.`,
      )
    }
    default:
      return say(HELP)
  }
}

type Morning = {
  date: string
  visits: number
  firstVisits: number
  bookedMinutes: number
  usualBookedMinutes: number | null
  openMinutes: number
  yesterdayTakings?: string
  usualYesterdayTakings?: string | null
}
type Notice = { title: string; detail: string }
type Reminder = { text: string; day: string; overdue: boolean }
type Reminders = { due: Reminder[]; coming: Reminder[] }

/** Today's reminders, and for the full list the next few coming up. */
function describeReminders(r: Reminders, todayOnly: boolean) {
  const due = r.due.map((x) => (x.overdue ? `${x.text} (from ${x.day})` : x.text))
  const parts = due.length ? [`Reminders for today: ${due.join('; ')}.`] : []
  if (!todayOnly && r.coming.length)
    parts.push(`Coming up: ${r.coming.map((x) => `${x.day}, ${x.text}`).join('; ')}.`)
  return parts.join(' ')
}

/** "Remind me on Friday to call the supplier": the thing to do, as a short sentence. */
function reminderText(question: string) {
  const found = /\bto\s+(.{2,200}?)[?.!\s]*$/i
    .exec(
      question
        .replace(
          /\b(on|this|next)?\s*(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' '),
    )?.[1]
    ?.trim()
  return found ? found[0].toUpperCase() + found.slice(1) : undefined
}
type Waiting = {
  entryId: string
  client: string
  service: string
  professional?: string
  suits: string
  openings: {
    date: string
    startMinutes: number
    staffId: string
    time: string
    professional: string
  }[]
}
type Idea = {
  signalId: string
  title: string
  from: string
  to: string
  reason: string
  room: string
  idea: string
}

/** The suggestion whose name the person used, such as "plan the Diwali special". */
function pickIdea(q: string, ideas: Idea[]) {
  const words = (s: string) => s.toLowerCase().match(/[a-z']{4,}/g) ?? []
  return ideas.find((g) => words(g.title).some((w) => q.includes(w)))
}
type Drifting = {
  name: string
  weeksSince: number
  usualWeeks: number | null
  openTime?: { date: string; time: string; professional: string; service: string }
}

const hours = (minutes: number) => {
  const h = Math.round(minutes / 30) / 2
  return `${h} ${h === 1 ? 'hour' : 'hours'}`
}

function describeMorning(m: Morning, day: (date: string) => string) {
  const parts = [
    m.visits
      ? `${day(m.date)}: ${m.visits} ${m.visits === 1 ? 'visit' : 'visits'}, ${hours(m.bookedMinutes)} booked${m.usualBookedMinutes ? ` (a usual ${day(m.date).split(' ')[0]} has about ${hours(m.usualBookedMinutes)})` : ''}${m.firstVisits ? `, ${m.firstVisits} first ${m.firstVisits === 1 ? 'visit' : 'visits'}` : ''}.`
      : `Nothing is booked for ${day(m.date)} yet.`,
  ]
  if (m.openMinutes >= 60) parts.push(`${hours(m.openMinutes)} of the team's time is still open.`)
  if (m.yesterdayTakings)
    parts.push(
      `Yesterday took ${m.yesterdayTakings}${m.usualYesterdayTakings ? `, against about ${m.usualYesterdayTakings} usually` : ''}.`,
    )
  return parts.join(' ')
}

function describeNotices(notices: Notice[] | undefined) {
  if (!notices?.length) return ''
  return notices.map((n) => `${n.title}: ${n.detail}`).join(' ')
}

type Visit = {
  time: string
  client: string
  service: string
  professional: string
  status: string
  firstVisit: boolean
}
type Day = { date: string; visits: Visit[]; free: { professional: string; freeTimes: string[] }[] }
type Brief = {
  name: string
  preferences?: string
  completedVisits: number
  lastVisit?: { date: string; service: string; professional: string }
  nextVisit?: {
    appointmentId: string
    date: string
    time: string
    service: string
    professional: string
  }
  marketingConsent: boolean
  plans: { name: string; visitsLeft: number; state: string }[]
}

function describeDay(day: Day, label: (date: string) => string) {
  const booked = day.visits.filter((v) => v.status !== 'cancelled')
  if (!booked.length) return `Nothing is booked for ${label(day.date)}.`
  const firsts = booked.filter((v) => v.firstVisit).length
  const lines = booked
    .slice(0, 8)
    .map((v) => `${v.time} ${v.client}, ${v.service} with ${v.professional}`)
  const free = day.free
    .filter((f) => f.freeTimes.length)
    .map((f) => `${f.professional} is free ${f.freeTimes[0]}`)
  return [
    `${booked.length} ${booked.length === 1 ? 'visit' : 'visits'} on ${label(day.date)}${firsts ? `, ${firsts} of them a first visit` : ''}.`,
    lines.join('; ') + (booked.length > 8 ? '; and more.' : '.'),
    free.length ? `Gaps: ${free.slice(0, 3).join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function describeBrief(b: Brief, day: (date: string) => string) {
  const parts = [
    `${b.name} has had ${b.completedVisits} ${b.completedVisits === 1 ? 'visit' : 'visits'}.`,
  ]
  if (b.lastVisit)
    parts.push(
      `Last visit on ${day(b.lastVisit.date)} for ${b.lastVisit.service} with ${b.lastVisit.professional}.`,
    )
  if (b.nextVisit)
    parts.push(
      `Next booked for ${day(b.nextVisit.date)} at ${b.nextVisit.time}, ${b.nextVisit.service} with ${b.nextVisit.professional}.`,
    )
  else parts.push('Nothing booked yet.')
  if (b.preferences) parts.push(`Preferences: ${b.preferences}`)
  for (const p of b.plans.filter((p) => p.state === 'active'))
    parts.push(`${p.name}: ${p.visitsLeft} ${p.visitsLeft === 1 ? 'visit' : 'visits'} left.`)
  parts.push(b.marketingConsent ? 'Happy to hear about offers.' : 'Has not agreed to marketing.')
  return parts.join(' ')
}

type Catalogue = {
  services: { serviceId: string; name: string }[]
  professionals: { staffId: string; name: string; serviceIds: string[] }[]
}
type FreeTimes = {
  staffId: string
  professional: string
  times: { minutes: number; label: string }[]
}[]
type VisitAt = {
  appointmentId: string
  clientId: string
  client: string
  time: string
  service: string
  professional: string
  next?: { time: string; client: string }
}
type Recap = {
  date: string
  completed: number
  takings: string
  usualTakings: string | null
  rebooked: number
  notRebooked: { name: string; marketingConsent: boolean }[]
  cancelled: number
  missed: number
  tomorrow: {
    date: string
    visits: number
    firstStart: string | null
    firstVisitClient: string | null
    gaps: { name: string; from: string; hours: number }[]
  }
}
type Review = {
  visits: number
  usualVisits: number | null
  takings: string
  usualTakings: string | null
  quietest: { date: string; visits: number; usualVisits: number; reasons: string[] } | null
  ideas: string[]
}

const STOP = new Set(['and', 'the', 'with', 'for', 'in', 'on', 'at', 'a', 'an', 'my', 'me'])
const words = (s: string) =>
  (s.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w))
const mentions = (q: string, name: string) => words(name).some((w) => new RegExp(`\\b${w}`).test(q))
const firstName = (name: string) => name.split(' ')[0]
const partOfDay = (q: string) =>
  /\bmorning\b/.test(q)
    ? (m: number) => m < 720
    : /\bafternoon\b/.test(q)
      ? (m: number) => m >= 720 && m < 1020
      : /\bevening\b/.test(q)
        ? (m: number) => m >= 1020
        : () => true
/** Up to four times at least an hour apart, so the choices cover the part of the day. */
const spread = (times: { minutes: number; label: string }[]) =>
  times
    .reduce<typeof times>(
      (kept, x) =>
        kept.length && x.minutes - kept[kept.length - 1].minutes < 60 ? kept : [...kept, x],
      [],
    )
    .slice(0, 4)
const result = <T>(results: Result[], name: string) =>
  results.find((r) => r.name === name && r.ok)?.data as T | undefined

/** The manager's everyday jobs: someone off, booking, cancelling, a visit by time, and closing. */
function managerFlow(
  question: string,
  results: Result[],
  day: (date: string) => string,
  today: string,
): Step | null {
  const q = question.toLowerCase()
  const last = results[results.length - 1]

  if (ABSENT.test(q) && !/^\s*(book|cancel)\b/.test(q)) {
    if (last.name === 'catalogue') {
      const person = (last.data as Catalogue).professionals.find((p) =>
        mentions(q, firstName(p.name)),
      )
      if (!person) return say('Which professional is off? Say their first name.')
      return call('cover_absence', { staffId: person.staffId, date: dayIn(q, today) })
    }
    if (last.name === 'cover_absence')
      return say(
        'Here is a plan for the day. Nothing changes until you approve it, and the notes to guests are saved unsent for you to send from the Inbox.',
      )
  }

  if (/^\s*book\b/.test(q)) {
    if (last.name === 'free_times') {
      const free = last.data as FreeTimes
      const at = clockTime(q.replace(/^\s*book\b/, ''))
      const exact =
        at === null ? undefined : free.find((f) => f.times.some((x) => x.minutes === at))
      const input = results.find((r) => r.name === 'free_times')!.input
      const found = result<{ clientId: string }[]>(results, 'find_client')!
      if (exact && at !== null)
        return call('book_visit', {
          clientId: found[0].clientId,
          serviceId: input.serviceId,
          staffId: exact.staffId,
          date: input.date,
          startMinutes: at,
        })
      const fits = partOfDay(q)
      const options = free
        .map((f) => ({ ...f, times: spread(f.times.filter((x) => fits(x.minutes))) }))
        .filter((f) => f.times.length)
      if (!options.length)
        return say(`Nothing is free then on ${day(String(input.date))}. Try another day.`)
      const list = options
        .map((f) => `${firstName(f.professional)} at ${f.times.map((x) => x.label).join(', ')}`)
        .join('; ')
      return say(
        `${at !== null ? 'That time is taken. ' : ''}Free on ${day(String(input.date))}: ${list}. Ask again with a time, such as "book ${firstName(question.split(/\s+/)[1] ?? 'them')} with ${firstName(options[0].professional)} on ${day(String(input.date)).split(' ')[0]} at ${options[0].times[0].label}".`,
      )
    }
    if (last.name === 'book_visit')
      return say('I have prepared the booking below. Nothing is booked until you approve it.')
    const found = result<{ clientId: string; name: string }[]>(results, 'find_client')
    const catalogue = result<Catalogue>(results, 'catalogue')
    if (found && catalogue) {
      if (!found.length) return say(`I could not find a client called ${bookingName(question)}.`)
      if (found.length > 1)
        return say(`I found ${found.map((c) => c.name).join(', ')}. Which one do you mean?`)
      const rest = q.slice(q.indexOf(found[0].name.split(' ')[0].toLowerCase()) + 1)
      const service = catalogue.services.find((x) => mentions(rest, x.name))
      if (!service)
        return say(`Which treatment? ${catalogue.services.map((x) => x.name).join(', ')}.`)
      const person = catalogue.professionals.find(
        (p) => p.serviceIds.includes(service.serviceId) && mentions(rest, firstName(p.name)),
      )
      return call('free_times', {
        serviceId: service.serviceId,
        date: dayIn(q, today),
        ...(person && { staffId: person.staffId }),
      })
    }
  }

  if (/^\s*cancel\b/.test(q)) {
    if (last.name === 'find_client') {
      const found = last.data as { clientId: string; name: string }[]
      if (!found.length) return say(`I could not find a client called ${cancelName(question)}.`)
      if (found.length > 1)
        return say(`I found ${found.map((c) => c.name).join(', ')}. Which one do you mean?`)
      return call('client_brief', { clientId: found[0].clientId })
    }
    if (last.name === 'client_brief') {
      const brief = last.data as Brief
      if (!brief.nextVisit) return say(`${brief.name} has nothing booked to cancel.`)
      const reason = /\bbecause\s+(.{2,200})$/i.exec(question)?.[1].replace(/[.!?]$/, '')
      return call('cancel_visit', {
        appointmentId: brief.nextVisit.appointmentId,
        reason: reason ?? 'Client asked to cancel',
      })
    }
    if (last.name === 'cancel_visit')
      return say(
        'I have prepared the cancellation below. Nothing changes until you approve it, and no fee is charged unless you choose to.',
      )
  }

  const at = result<VisitAt[]>(results, 'visit_at')
  if (at) {
    if (last.name === 'visit_at') {
      if (!at.length) return say('Nothing starts around then.')
      return call('client_brief', { clientId: at[0].clientId })
    }
    if (last.name === 'client_brief') {
      const v = at[0]
      const others =
        at.length > 1
          ? ` Also then: ${at
              .slice(1)
              .map((x) => `${x.client} with ${firstName(x.professional)}`)
              .join('; ')}.`
          : ''
      const next = v.next
        ? ` After that, ${firstName(v.professional)} has ${v.next.client} at ${v.next.time}.`
        : ''
      return say(
        `${v.time}: ${v.client}, ${v.service} with ${firstName(v.professional)}. ${guestNote(last.data as Brief, day)}${others}${next}`,
      )
    }
  }

  if (last.name === 'day_recap') {
    const r = last.data as Recap
    const parts = [
      r.completed
        ? `${r.takings} in treatments from ${r.completed} ${r.completed === 1 ? 'visit' : 'visits'}${r.usualTakings ? `, against about ${r.usualTakings} on a usual ${day(r.date).split(' ')[0]}` : ''}. ${r.rebooked} of ${r.completed} booked their next visit.`
        : `No visits were completed on ${day(r.date)}.`,
    ]
    if (r.cancelled || r.missed) parts.push(`${r.cancelled} cancelled and ${r.missed} missed.`)
    const willing = r.notRebooked.filter((c) => c.marketingConsent)
    if (r.notRebooked.length)
      parts.push(
        `${r.notRebooked.length} left without a next visit${willing.length ? `; ${willing.map((c) => c.name).join(', ')} ${willing.length === 1 ? 'is' : 'are'} happy to hear from you, so say "invite" and a name for a gentle note` : ''}.`,
      )
    const t = r.tomorrow
    parts.push(
      t.visits
        ? `Tomorrow: ${t.visits} ${t.visits === 1 ? 'visit' : 'visits'}, starting at ${t.firstStart}${t.firstVisitClient ? ` with ${t.firstVisitClient}'s first visit` : ''}.${t.gaps.length ? ` ${t.gaps.map((g) => `${firstName(g.name)} has ${g.hours} hours free from ${g.from}`).join('; ')}.` : ''}`
        : 'Nothing is booked for tomorrow yet.',
    )
    return say(parts.join(' '))
  }

  if (last.name === 'week_review') {
    const r = last.data as Review
    const parts = [
      `The last seven days: ${r.takings} from ${r.visits} visits${r.usualTakings ? `, against about ${r.usualTakings} and ${r.usualVisits} visits in a usual week` : ''}.`,
    ]
    if (r.quietest)
      parts.push(
        `${day(r.quietest.date)} was the quietest against usual, ${r.quietest.visits} ${r.quietest.visits === 1 ? 'visit' : 'visits'} instead of about ${r.quietest.usualVisits}: ${r.quietest.reasons.join('; ')}.`,
      )
    else parts.push('No day was much quieter than usual.')
    if (r.ideas.length) parts.push(`Ideas: ${r.ideas.join(' ')}`)
    return say(parts.join(' '))
  }
  return null
}

/** What to know before a guest walks in: how well we know them, last visit, preferences, plans. */
function guestNote(b: Brief, day: (date: string) => string) {
  const parts = [
    b.completedVisits
      ? `${b.completedVisits} ${b.completedVisits === 1 ? 'visit' : 'visits'} so far${b.lastVisit ? `, the last on ${day(b.lastVisit.date)} for ${b.lastVisit.service}` : ''}.`
      : 'Their first visit.',
  ]
  if (b.preferences) parts.push(`Preferences: ${b.preferences}`)
  for (const p of b.plans.filter((p) => p.state === 'active'))
    parts.push(`${p.name}: ${p.visitsLeft} ${p.visitsLeft === 1 ? 'visit' : 'visits'} left.`)
  return parts.join(' ')
}
