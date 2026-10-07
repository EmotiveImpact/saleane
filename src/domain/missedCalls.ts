import type { BusinessState } from './model'
import { addDays } from './format'
import { businessDate, operations } from './operations'
import { MISSED_CALL_LIMIT } from './missedCallsSchema'
import type { MissedCall } from './missedCallsSchema'
import { clientsWithNumber, textNumber } from './reminders'

/**
 * V1.5: missed-call text-back. When the studio cannot pick up, the call is written down (by the
 * team, or by the studio's phone line once one is connected) so someone calls back. If the studio
 * switches it on, the caller also gets one text with the booking link, once a day at most.
 */

/** A stored number spaced for reading: +44 7700 900123, +1 212 555 0100. */
export function numberLabel(number: string) {
  const uk = /^\+44(\d{4})(\d{6})$/.exec(number)
  if (uk) return `+44 ${uk[1]} ${uk[2]}`
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number)
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`
  return number
}

/** Open calls stay on the desk's list for this many days. */
export const MISSED_CALL_DAYS = 7

/**
 * A number a caller can be texted on. Accepts one written with its country code, or a local
 * number in the studio's own country (07700 900123 in the UK, (212) 555-0100 in the US).
 */
export function callerNumber(s: BusinessState, typed: string) {
  // "+44 (0)7700 900123" is a common way to write a UK number; the 0 is not dialled from abroad.
  const compact = typed.replace(/\(0\)/g, '').replace(/[\s().-]/g, '')
  if (compact.startsWith('+')) return textNumber(compact)
  if (compact.startsWith('00')) return textNumber(`+${compact.slice(2)}`)
  const digits = compact.replace(/\D/g, '')
  if (digits !== compact) return null
  if (s.organisation.region === 'UK' && /^0\d{9,10}$/.test(digits))
    return textNumber(`+44${digits.slice(1)}`)
  if (s.organisation.region === 'US') {
    if (/^\d{10}$/.test(digits)) return textNumber(`+1${digits}`)
    if (/^1\d{10}$/.test(digits)) return textNumber(`+${digits}`)
  }
  return null
}

/** Calls nobody has called back yet, newest first, from the last week. */
export function openMissedCalls(s: BusinessState, nowIso?: string) {
  const since = addDays(businessDate(s, nowIso), -MISSED_CALL_DAYS)
  return (operations(s).missedCalls ?? [])
    .filter((call) => !call.calledBackAt && businessDate(s, call.lastAt) >= since)
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

/**
 * Writes a missed call down. A number that rings again the same day, before anyone has called
 * back, adds to its open entry rather than making a new one, so the desk sees one line.
 */
export function recordMissedCall(
  next: BusinessState,
  input: { number: string; source?: MissedCall['source'] },
  now: string,
  makeId: () => string,
) {
  const number = callerNumber(next, input.number)
  if (!number)
    throw new Error(
      next.organisation.region === 'US'
        ? 'Enter the caller’s number, for example (212) 555-0100 or +1 212 555 0100.'
        : 'Enter the caller’s number, for example 07700 900123 or +44 7700 900123.',
    )
  next.operations ??= operations(next)
  const calls = (next.operations.missedCalls ??= [])
  const today = businessDate(next, now)
  const open = calls.find(
    (call) => call.number === number && !call.calledBackAt && businessDate(next, call.at) === today,
  )
  if (open) {
    open.calls = Math.min(open.calls + 1, 1000)
    if (now > open.lastAt) open.lastAt = now
    return open.id
  }
  // Nothing is deleted automatically (owner decision, 7 October 2026), so a full list says so.
  if (calls.length >= MISSED_CALL_LIMIT)
    throw new Error('The missed calls list is full, so this call was not added.')
  const matches = clientsWithNumber(next, number)
  const call: MissedCall = {
    id: makeId(),
    number,
    at: now,
    lastAt: now,
    calls: 1,
    source: input.source ?? 'desk',
    ...(matches.length === 1 ? { clientId: matches[0].id } : {}),
    actor: 'Local operator',
  }
  calls.push(call)
  return call.id
}

/** Someone called them back. Saying so twice changes nothing. */
export function markCalledBack(next: BusinessState, callId: string, now: string) {
  const call = (operations(next).missedCalls ?? []).find((c) => c.id === callId)
  if (!call) throw new Error('That call is not on the list.')
  if (!call.calledBackAt) {
    call.calledBackAt = now
    call.calledBackBy = 'Local operator'
  }
  return call.id
}
