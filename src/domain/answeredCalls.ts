import type { BusinessState } from './model'
import { addDays } from './format'
import { businessDate, operations } from './operations'
import { ANSWERED_CALL_LIMIT } from './answeredCallsSchema'
import type { AnsweredCall, CallTurn } from './answeredCallsSchema'
import { clientsWithNumber } from './reminders'
import { MISSED_CALL_DAYS } from './missedCalls'

/**
 * NEXT-17: calls the AI receptionist answered. The phone line writes each one down as it ends;
 * the desk reads it and marks it done once followed up.
 */

export type CallRecord = {
  /** The caller's number with its country code, or undefined when withheld. */
  number?: string
  /** When it was answered. */
  startedAt: string
  seconds: number
  turns: CallTurn[]
  texted: string[]
  message?: AnsweredCall['message']
}

/** Writes an answered call down. A full list refuses it rather than dropping older calls. */
export function recordAnsweredCall(next: BusinessState, input: CallRecord, makeId: () => string) {
  next.operations ??= operations(next)
  const calls = (next.operations.answeredCalls ??= [])
  // Nothing is deleted automatically (owner decision, 7 October 2026), so a full list says so.
  if (calls.length >= ANSWERED_CALL_LIMIT)
    throw new Error('The answered calls list is full, so this call was not added.')
  const matches = input.number ? clientsWithNumber(next, input.number) : []
  const call: AnsweredCall = {
    id: makeId(),
    ...(input.number ? { number: input.number } : {}),
    at: input.startedAt,
    seconds: Math.max(0, Math.min(7200, Math.round(input.seconds))),
    turns: input.turns,
    texted: input.texted,
    ...(input.message ? { message: input.message } : {}),
    ...(matches.length === 1 ? { clientId: matches[0].id } : {}),
  }
  calls.push(call)
  return call.id
}

/** Someone at the studio followed the call up. Saying so twice changes nothing. */
export function markCallDone(next: BusinessState, callId: string, now: string) {
  const call = (operations(next).answeredCalls ?? []).find((c) => c.id === callId)
  if (!call) throw new Error('That call is not on the list.')
  if (!call.doneAt) {
    call.doneAt = now
    call.doneBy = 'Local operator'
  }
  return call.id
}

/**
 * The week's answered calls nobody has marked done, newest first, those with a message for the
 * team before the rest.
 */
export function openAnsweredCalls(s: BusinessState, nowIso?: string) {
  const since = addDays(businessDate(s, nowIso), -MISSED_CALL_DAYS)
  return (operations(s).answeredCalls ?? [])
    .filter((call) => !call.doneAt && businessDate(s, call.at) >= since)
    .sort((a, b) => Number(!!b.message) - Number(!!a.message) || b.at.localeCompare(a.at))
}

/** "3 minutes" or "under a minute", for how long a call lasted. */
export function callLength(seconds: number) {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}
