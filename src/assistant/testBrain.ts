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
      return { ...nextStep(lastQuestion(request), results, offered, day), costMinor: 0 }
    },
  }
}

const HELP =
  'In test mode I can answer a few things from your records: your morning brief, anything unusual, who is drifting away, what is on today or tomorrow, who is due back, takings, money owed, plans running low, low stock, and a brief on a client ("tell me about Maya"). I can also prepare an invitation for a client to come back ("invite Maya back") for you to approve.'

const MANAGERS_ONLY = 'That is for owners and managers.'

type Step = { text?: string; calls: ToolCall[] }
type Result = { name: string; input: Record<string, unknown>; ok: boolean; data: unknown }

function lastQuestion(request: BrainRequest) {
  const users = request.messages.filter((m) => m.role === 'user')
  return (users[users.length - 1]?.text ?? '').trim()
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

const NOT_NAMES = /^(today|tomorrow|this|the|my|our|us|me|due|it|that)\b/i

function firstStep(question: string, today: string, offered: Set<string>): Step {
  const q = question.toLowerCase()
  const need = (skill: string, step: Step) => (offered.has(skill) ? step : say(MANAGERS_ONLY))
  if (/\b(invite|draft|message|text|email)\b/.test(q) && clientName(question))
    return offered.has('draft_message')
      ? call('find_client', { name: clientName(question)! })
      : say('Your role cannot prepare messages.')
  if (/\b(brief|summary|morning|overview)\b/.test(q) && !clientName(question))
    return { calls: [...call('morning_brief').calls, ...call('unusual').calls] }
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
): Step {
  const last = results[results.length - 1]
  if (!last.ok) return say(String(last.data))
  const brief = results.find((r) => r.name === 'morning_brief')
  if (brief?.ok) {
    const notices = results.find((r) => r.name === 'unusual')
    return say(
      [describeMorning(brief.data as Morning, day), describeNotices(notices?.data as Notice[])]
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
  nextVisit?: { date: string; time: string; service: string; professional: string }
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
