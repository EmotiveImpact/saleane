import { addDays, timeLabel } from './format'
import { leads } from './operations'
import { unusual } from './insights'
import type { BusinessState } from './model'
import type { Role } from './operations'
import { dueTasks } from './tasks'
import { openings, serviceLabel, waiting } from './waitlist'

/**
 * V3: what Ask Saleane mentions first when it is opened, so the manager does not have to think of
 * the question. Each nudge carries the question that follows it up, asked with one tap. Nothing is
 * sent or changed by a nudge.
 */
export type Nudge = { id: string; text: string; ask: string }

const NUDGES_SHOWN = 3
const first = (name: string) => name.split(' ')[0]

export function nudges(s: BusinessState, role: Role, today: string, now: string): Nudge[] {
  if (role === 'practitioner') return []
  const managers = leads(role)
  const locale = s.organisation.locale
  const tomorrow = addDays(today, 1)
  const found: Nudge[] = []

  // A time someone on the waitlist could take today or tomorrow, often freed by a cancellation.
  // Only these two days are searched, so this stays quick enough to run on every change.
  for (const entry of waiting(s, now)) {
    const soon = { ...entry, toDate: entry.toDate < tomorrow ? entry.toDate : tomorrow }
    const opening = openings(s, soon, now, 1)[0]
    if (!opening) continue
    const client = s.clients.find((c) => c.id === entry.clientId)
    const person = s.staff.find((p) => p.id === opening.staffId)
    if (!client || !person) continue
    const when = opening.date === today ? 'today' : 'tomorrow'
    const at = timeLabel(opening.startMinutes, locale)
    found.push({
      id: `waitlist-${entry.id}`,
      text: `${client.name} is waiting for ${serviceLabel(s, entry)}, and ${first(person.name)} is free ${when} at ${at}.`,
      ask: `Offer ${first(client.name)} ${when} at ${at}`,
    })
    if (found.length === 2) break
  }

  const due = dueTasks(s, today)
  if (due.length)
    found.push({
      id: 'reminders',
      text:
        due.length === 1
          ? `A reminder for today: ${due[0].text}.`
          : `${due.length} reminders for today, starting with: ${due[0].text}.`,
      ask: 'What reminders do I have?',
    })

  const notice = unusual(s, today).find((n) => managers || !n.managersOnly)
  if (notice)
    found.push({
      id: `notice-${notice.id}`,
      text: `${notice.title}. ${notice.detail}`,
      ask: 'Anything unusual?',
    })

  return found.slice(0, NUDGES_SHOWN)
}
