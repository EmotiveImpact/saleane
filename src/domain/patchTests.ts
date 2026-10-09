import type { Command } from './commandSchema'
import type { Appointment, BusinessState, RelationshipEvent } from './model'
import type { PatchTest, PatchTestSettings } from './patchTestsSchema'
import { defaultPatchTestSettings } from './patchTestsSchema'
import { instantFor, operations } from './operations'
import { addMonths } from './plans'
import { addDays, dateLabel } from './format'
import { bookablePlaces } from './locations'

/**
 * V1.5: patch test records and reminders. A treatment can be marked as needing a patch test. For a
 * visit for that treatment the guest needs a clear test done at least `hoursBefore` hours before
 * the visit and no more than `validMonths` months before it. A recorded reaction stops the visit
 * going ahead until a later clear test is recorded. This is a salon record, not a clinical one.
 */
const HOUR = 60 * 60000

export function patchTests(s: BusinessState) {
  return s.patchTests ?? []
}
export function patchTestSettings(s: BusinessState): PatchTestSettings {
  return operations(s).patchTests ?? defaultPatchTestSettings
}
export function serviceNeedsPatchTest(s: BusinessState, serviceId: string) {
  return !!s.services.find((x) => x.id === serviceId)?.patchTest
}
/** The studio's own calendar date of an instant. */
export function localDate(s: BusinessState, iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: s.organisation.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export type PatchTestState = 'clear' | 'waiting' | 'too-close' | 'reaction' | 'needed'
export type PatchTestStanding = {
  state: PatchTestState
  /** The test this answer rests on, when there is one. */
  test?: PatchTest
  /** One plain sentence for staff. */
  label: string
}

/**
 * Where a client stands for a visit starting at `startIso`. The latest reaction wins unless a
 * clear test was done after it; otherwise a clear test in the window counts, then a test awaiting
 * its result, then one done too close to the visit.
 */
/** Whether a test is recent enough and early enough to count for a visit starting then. */
export function countsForVisit(s: BusinessState, test: PatchTest, startIso: string) {
  const settings = patchTestSettings(s)
  const start = Date.parse(startIso)
  return (
    addMonths(localDate(s, test.testedAt), settings.validMonths) >= localDate(s, startIso) &&
    start - Date.parse(test.testedAt) >= settings.hoursBefore * HOUR
  )
}

export function patchTestStanding(
  s: BusinessState,
  clientId: string,
  startIso: string,
): PatchTestStanding {
  const settings = patchTestSettings(s)
  const locale = s.organisation.locale
  const on = (test: PatchTest) => dateLabel(localDate(s, test.testedAt), locale)
  const start = Date.parse(startIso)
  const visitDate = localDate(s, startIso)
  const mine = patchTests(s)
    .filter((t) => t.clientId === clientId && Date.parse(t.testedAt) < start)
    .sort((a, b) => b.testedAt.localeCompare(a.testedAt))
  const reaction = mine.find((t) => t.result?.outcome === 'reaction')
  if (
    reaction &&
    !mine.some((t) => t.result?.outcome === 'clear' && t.testedAt > reaction.testedAt)
  )
    return {
      state: 'reaction',
      test: reaction,
      label: `Reacted to a patch test on ${on(reaction)}`,
    }
  const fresh = mine.filter(
    (t) =>
      t.result?.outcome !== 'reaction' &&
      addMonths(localDate(s, t.testedAt), settings.validMonths) >= visitDate,
  )
  const early = fresh.filter((t) => start - Date.parse(t.testedAt) >= settings.hoursBefore * HOUR)
  const clear = early.find((t) => t.result?.outcome === 'clear')
  if (clear) return { state: 'clear', test: clear, label: `Patch test clear on ${on(clear)}` }
  const waiting = early.find((t) => !t.result)
  if (waiting)
    return {
      state: 'waiting',
      test: waiting,
      label: `Patch test on ${on(waiting)}, result not recorded yet`,
    }
  const close = fresh[0]
  if (close)
    return {
      state: 'too-close',
      test: close,
      label: `Patch test on ${on(close)} is less than ${settings.hoursBefore} hours before`,
    }
  const last = mine.find((t) => t.result?.outcome === 'clear')
  return {
    state: 'needed',
    ...(last ? { test: last } : {}),
    label: last
      ? `Needs a new patch test: the last clear one was on ${on(last)}`
      : `Needs a patch test at least ${settings.hoursBefore} hours before`,
  }
}

/** For a visit: null when its treatment needs no patch test or its time cannot be read. */
export function visitPatchTest(s: BusinessState, a: Appointment) {
  if (!serviceNeedsPatchTest(s, a.serviceId)) return null
  try {
    return patchTestStanding(s, a.clientId, instantFor(s, a.date, a.startMinutes))
  } catch {
    return null
  }
}

/** Upcoming confirmed visits in the next `days` days whose patch test is not yet in order. */
export function patchTestsDue(s: BusinessState, today: string, days = 14) {
  const until = addDays(today, days)
  return s.appointments
    .filter((a) => a.status === 'confirmed' && a.date >= today && a.date <= until)
    .map((a) => ({ appointment: a, standing: visitPatchTest(s, a) }))
    .filter(
      (row): row is { appointment: Appointment; standing: PatchTestStanding } =>
        !!row.standing && row.standing.state !== 'clear',
    )
    .sort(
      (x, y) =>
        x.appointment.date.localeCompare(y.appointment.date) ||
        x.appointment.startMinutes - y.appointment.startMinutes,
    )
}

type AddEvent = (
  event: Omit<RelationshipEvent, 'id' | 'organisationId' | 'occurredAt' | 'actor'>,
) => void
type PatchCommand = Extract<
  Command,
  { type: 'patch-test' | 'patch-test-result' | 'patch-test-settings' }
>

export function runPatchTestCommand(
  next: BusinessState,
  command: PatchCommand,
  now: string,
  makeId: () => string,
  addEvent: AddEvent,
) {
  const org = next.organisation
  if (command.type === 'patch-test-settings') {
    const chosen = command.settings.testServiceId
    if (chosen) {
      const service = next.services.find((x) => x.id === chosen)
      if (!service || service.archived) throw new Error('Choose a treatment on the menu.')
      if (service.patchTest)
        throw new Error('The patch test itself cannot be a treatment that needs a patch test.')
    }
    next.operations = { ...operations(next), patchTests: command.settings }
    return org.id
  }
  if (command.type === 'patch-test') {
    const input = command.input
    const client = next.clients.find((c) => c.id === input.clientId)
    if (!client) throw new Error('Client does not belong to this studio.')
    if (input.staffId && !next.staff.some((p) => p.id === input.staffId && !p.archived))
      throw new Error('Choose someone who works here.')
    if (Date.parse(input.testedAt) > Date.parse(now) + 5 * 60000)
      throw new Error('A patch test cannot be recorded before it is done.')
    if (command.result && Date.parse(input.testedAt) > Date.parse(now))
      throw new Error('Record the result once the skin has been checked.')
    if (command.result) resultProblem(next, input.testedAt, command.result.outcome, now)
    const test: PatchTest = {
      ...input,
      testedAt: new Date(input.testedAt).toISOString(),
      id: makeId(),
      organisationId: org.id,
      recordedAt: now,
      actor: '',
      ...(command.result ? { result: { ...command.result, at: now, actor: '' } } : {}),
    }
    next.patchTests = [...patchTests(next), test]
    addEvent({
      clientId: client.id,
      type: 'patch_test',
      title: command.result ? resultTitle(command.result.outcome) : 'Patch test done',
      detail: `${input.product}, ${dateLabel(localDate(next, input.testedAt), org.locale)}.`,
    })
    return test.id
  }
  const test = patchTests(next).find((t) => t.id === command.patchTestId)
  if (!test) throw new Error('This patch test was not recorded here.')
  if (test.result) throw new Error('A result is already recorded. Record a new test instead.')
  if (Date.parse(test.testedAt) > Date.parse(now))
    throw new Error('Record the result once the skin has been checked.')
  resultProblem(next, test.testedAt, command.outcome, now)
  test.result = { outcome: command.outcome, notes: command.notes, at: now, actor: '' }
  addEvent({
    clientId: test.clientId,
    type: 'patch_test',
    title: resultTitle(command.outcome),
    detail: `${test.product}, tested ${dateLabel(localDate(next, test.testedAt), org.locale)}.`,
  })
  return test.id
}
/** When a test can be called clear: once the studio's full waiting time has passed. */
export function clearFrom(s: BusinessState, testedAt: string) {
  return new Date(Date.parse(testedAt) + patchTestSettings(s).hoursBefore * 3600000).toISOString()
}
/** A reaction can be recorded as soon as it shows; clear only after the full wait. */
function resultProblem(
  s: BusinessState,
  testedAt: string,
  outcome: 'clear' | 'reaction',
  now: string,
) {
  if (outcome === 'clear' && Date.parse(now) < Date.parse(clearFrom(s, testedAt)))
    throw new Error(
      `A test can be called clear once ${patchTestSettings(s).hoursBefore} hours have passed. Record a reaction straight away if one shows.`,
    )
}
function resultTitle(outcome: 'clear' | 'reaction') {
  return outcome === 'clear' ? 'Patch test clear' : 'Reaction to a patch test'
}

/** The same result sent twice, such as from a retried request: nothing changes. */
export function repeatedPatchResult(
  s: BusinessState,
  command: Extract<Command, { type: 'patch-test-result' }>,
) {
  const test = patchTests(s).find((t) => t.id === command.patchTestId)
  return test?.result?.outcome === command.outcome && test.result.notes === command.notes
    ? test
    : null
}

export function stampPatchTestActors(before: BusinessState, after: BusinessState, actor: string) {
  const old = new Map(patchTests(before).map((t) => [t.id, t]))
  for (const test of patchTests(after)) {
    const previous = old.get(test.id)
    if (!previous) test.actor = actor
    if (test.result && !previous?.result) test.result.actor = actor
  }
}

/** Ledger checks for parseState. */
export function patchTestsProblem(s: BusinessState) {
  const tests = patchTests(s)
  if (new Set(tests.map((t) => t.id)).size !== tests.length) return 'Duplicate patch test IDs.'
  for (const test of tests) {
    if (test.organisationId !== s.organisation.id) return 'Foreign workspace record.'
    if (!s.clients.some((c) => c.id === test.clientId)) return 'A patch test names no client.'
    if (test.result && Date.parse(test.result.at) < Date.parse(test.testedAt))
      return 'A patch test result comes before the test.'
  }
  return null
}

/** Whether a visit may start: a recorded reaction stops a treatment that needs a patch test. */
export function patchTestBlocksVisit(s: BusinessState, a: Appointment) {
  const standing = visitPatchTest(s, a)
  if (standing?.state !== 'reaction') return null
  return `${standing.label}. Change the treatment, or record a new clear test first.`
}

/**
 * Stage 3: the treatment guests book for a patch test, when the studio chose one and a guest can
 * book it: on the menu, needing no test itself, and offered somewhere by someone who does it.
 */
export function patchTestBooking(s: BusinessState) {
  const id = patchTestSettings(s).testServiceId
  const service = id ? s.services.find((x) => x.id === id) : undefined
  if (!service || service.archived || service.patchTest) return undefined
  return bookablePlaces(s, service).length ? service : undefined
}

/**
 * Stage 3: the one rule for every way a guest books without the desk: the booking page, the AI
 * receptionist (whose times are booked on that page), Book with Google and a guest moving their
 * own visit from its private link. Returns what the guest is told when the booking stops, or null
 * when it may go ahead.
 *
 * It stops only when the studio turned the rule on and the treatment needs a patch test. Then a
 * guest goes ahead only with a clear test that counts for the visit's time under the studio's
 * rules; a test still waiting for its result, one too close to the visit, one out of date and a
 * recorded reaction all stop it.
 *
 * `known` is the client and the visit's start, given only when the path knows who the guest is
 * for sure. Online, that is only the holder of a visit's private link. Everyone else is unknown:
 * a guest's typed email or phone number proves nothing and is never matched to a client, so an
 * unknown guest is always stopped, with the same words, and nobody can learn from the answer
 * whether someone is a client or has had a test.
 */
export function onlinePatchTestStop(
  s: BusinessState,
  serviceId: string,
  known?: { clientId: string; start: string },
): string | null {
  if (!patchTestSettings(s).stopOnline || !serviceNeedsPatchTest(s, serviceId)) return null
  if (known && patchTestStanding(s, known.clientId, known.start).state === 'clear') return null
  const name = s.services.find((x) => x.id === serviceId)!.name
  if (known)
    return `${name} needs a clear patch test that covers the new time, so it cannot be moved there online. Choose one of the times shown, or contact the studio to move it.`
  return `${name} needs a patch test first, so it cannot be booked online. ${
    patchTestBooking(s)
      ? 'Book a patch test, or if you have had one recently, contact the studio to book.'
      : 'Contact the studio to arrange one, or to book if you have had one recently.'
  }`
}

/** Stage 3: whether a treatment is kept off every way of booking without the desk. */
export const patchTestFirst = (s: BusinessState, serviceId: string) =>
  onlinePatchTestStop(s, serviceId) !== null
