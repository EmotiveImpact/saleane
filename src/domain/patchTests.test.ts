import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { parseState } from './model'
import { can } from './operations'
import { seed } from './seed'
import { addDays } from './format'
import { patchTestsDue, patchTests, visitPatchTest } from './patchTests'
import { planMessages, composeMessage } from './reminders'
import { practitionerRefusal, practitionerView } from './practitioner'
import { clientExport, clientExportText, erasureReview, previewClientExport } from './privacy'

// V1.5: patch test records and reminders.
const now = '2026-10-06T08:00:00.000Z'
let sequence = 0
function run(s: BusinessState, command: Command, at = now) {
  return execute(s, command, at, () => `patch-test-${++sequence}`)
}
function apply(s: BusinessState, command: Command, at = now) {
  const result = run(s, command, at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const visit = (s: BusinessState, id: string) => s.appointments.find((a) => a.id === id)!
const test = (clientId: string, testedAt: string, extra: Partial<Command> = {}): Command =>
  ({
    type: 'patch-test',
    input: { clientId, testedAt, product: 'Gloss toner 7.1', staffId: 'staff-theo', notes: '' },
    ...extra,
  }) as Command
/** Luca's cut this afternoon, turned into a colour so he can arrive for it today. */
function colourToday() {
  const s = structuredClone(seed('UK'))
  visit(s, 'visit-luca').serviceId = 'service-gloss'
  return parseState(s, 'UK')
}

describe('patch tests', () => {
  it('shows where each sample colour visit stands', () => {
    const s = seed('UK')
    expect(visitPatchTest(s, visit(s, 'visit-gloss-ellie'))?.state).toBe('clear')
    expect(visitPatchTest(s, visit(s, 'visit-gloss-grace'))?.state).toBe('waiting')
    expect(visitPatchTest(s, visit(s, 'visit-gloss-luca'))).toMatchObject({
      state: 'needed',
      label: 'Needs a patch test at least 48 hours before',
    })
    expect(visitPatchTest(s, visit(s, 'visit-noor'))).toBeNull()
    expect(patchTestsDue(s, '2026-10-06').map((row) => row.appointment.id)).toEqual([
      'visit-gloss-grace',
      'visit-gloss-luca',
    ])
  })

  it('records a test and its result on the client timeline, with who did them', () => {
    let s = seed('UK')
    const done = dispatch(s, test('client-9', '2026-10-06T07:30:00.000Z'), 'Theo Bennett', now)
    if (!done.ok) throw new Error(done.error)
    s = done.state
    const recorded = patchTests(s).at(-1)!
    expect(recorded).toMatchObject({ clientId: 'client-9', actor: 'Theo Bennett' })
    expect(visitPatchTest(s, visit(s, 'visit-gloss-luca'))?.state).toBe('waiting')
    const later = '2026-10-08T08:00:00.000Z'
    const checked = dispatch(
      s,
      {
        type: 'patch-test-result',
        patchTestId: recorded.id,
        outcome: 'clear',
        notes: 'No redness',
      },
      'Sample front desk',
      later,
    )
    if (!checked.ok) throw new Error(checked.error)
    s = checked.state
    expect(patchTests(s).at(-1)!.result).toMatchObject({
      outcome: 'clear',
      actor: 'Sample front desk',
    })
    expect(visitPatchTest(s, visit(s, 'visit-gloss-luca'))?.state).toBe('clear')
    expect(
      s.events
        .filter((e) => e.clientId === 'client-9' && e.type === 'patch_test')
        .map((e) => e.title),
    ).toEqual(['Patch test done', 'Patch test clear'])
  })

  it('does not count a test done too close to the visit, or one that has run out', () => {
    let s = seed('UK')
    s = apply(s, test('client-9', '2026-10-06T07:00:00.000Z'))
    // Luca's colour is on 10 October; a test on the 9th is too close.
    const close = apply(
      seed('UK'),
      test('client-9', '2026-10-09T09:00:00.000Z'),
      '2026-10-09T09:05:00.000Z',
    )
    expect(visitPatchTest(close, visit(close, 'visit-gloss-luca'))?.state).toBe('too-close')
    // A clear test seven months before is too old.
    const old = apply(
      seed('UK'),
      test('client-9', '2026-03-01T10:00:00.000Z', { result: { outcome: 'clear', notes: '' } }),
    )
    expect(visitPatchTest(old, visit(old, 'visit-gloss-luca'))).toMatchObject({
      state: 'needed',
      label: 'Needs a new patch test: the last clear one was on Sunday 1 March',
    })
    expect(visitPatchTest(s, visit(s, 'visit-gloss-luca'))?.state).toBe('waiting')
  })

  it('stops a visit going ahead after a reaction, until a later clear test', () => {
    let s = colourToday()
    s = apply(
      s,
      test('client-9', '2026-09-20T10:00:00.000Z', {
        result: { outcome: 'reaction', notes: 'Redness behind the ear' },
      }),
    )
    const refused = run(s, { type: 'arrive', appointmentId: 'visit-luca' })
    expect(refused.ok).toBe(false)
    if (!refused.ok)
      expect(refused.error).toContain('Reacted to a patch test on Sunday 20 September')
    s = apply(
      s,
      test('client-9', '2026-10-01T10:00:00.000Z', { result: { outcome: 'clear', notes: '' } }),
    )
    expect(run(s, { type: 'arrive', appointmentId: 'visit-luca' }).ok).toBe(true)
    // A treatment without a patch test is never stopped.
    expect(run(seed('UK'), { type: 'arrive', appointmentId: 'visit-grace' }).ok).toBe(true)
  })

  it('refuses a test in the future, a result before the test and a second result', () => {
    const s = seed('UK')
    expect(run(s, test('client-9', '2026-10-07T08:00:00.000Z')).ok).toBe(false)
    const pending = apply(s, test('client-9', '2026-10-06T07:59:00.000Z'))
    const id = patchTests(pending).at(-1)!.id
    const first = apply(
      pending,
      { type: 'patch-test-result', patchTestId: id, outcome: 'clear', notes: '' },
      '2026-10-08T08:00:00.000Z',
    )
    // Saying the same thing again changes nothing; saying something else is refused.
    const same = run(
      first,
      { type: 'patch-test-result', patchTestId: id, outcome: 'clear', notes: '' },
      '2026-10-08T09:00:00.000Z',
    )
    expect(same.ok && same.state.revision).toBe(first.revision)
    expect(
      run(first, { type: 'patch-test-result', patchTestId: id, outcome: 'reaction', notes: '' }).ok,
    ).toBe(false)
    expect(run(s, test('client-unknown', '2026-10-06T07:00:00.000Z')).ok).toBe(false)
  })

  it('calls a test clear only after the full wait, but takes a reaction straight away', () => {
    const pending = apply(seed('UK'), test('client-9', '2026-10-06T07:00:00.000Z'))
    const id = patchTests(pending).at(-1)!.id
    const early = run(
      pending,
      { type: 'patch-test-result', patchTestId: id, outcome: 'clear', notes: '' },
      '2026-10-07T07:00:00.000Z',
    )
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.error).toContain('48 hours')
    expect(
      run(
        pending,
        { type: 'patch-test-result', patchTestId: id, outcome: 'reaction', notes: 'Redness' },
        '2026-10-06T07:30:00.000Z',
      ).ok,
    ).toBe(true)
    expect(
      run(
        pending,
        { type: 'patch-test-result', patchTestId: id, outcome: 'clear', notes: '' },
        '2026-10-08T07:00:00.000Z',
      ).ok,
    ).toBe(true)
    // The same rule when the result comes with the test.
    const withClear = test('client-9', '2026-10-05T09:00:00.000Z', {
      result: { outcome: 'clear', notes: '' },
    })
    expect(run(seed('UK'), withClear).ok).toBe(false)
    expect(
      run(
        seed('UK'),
        test('client-9', '2026-10-05T09:00:00.000Z', {
          result: { outcome: 'reaction', notes: '' },
        }),
      ).ok,
    ).toBe(true)
  })

  it('lets practitioners record tests for their own clients, and only managers set the rules', () => {
    const s = seed('UK')
    expect(can('practitioner', 'patch-test')).toBe(true)
    expect(can('reception', 'patch-test')).toBe(true)
    expect(can('reception', 'patch-test-settings')).toBe(false)
    expect(can('manager', 'patch-test-settings')).toBe(true)
    const theo = test('client-9', '2026-10-06T07:00:00.000Z')
    expect(practitionerRefusal(s, 'staff-theo', theo, '2026-10-06')).toBeNull()
    expect(practitionerRefusal(s, 'staff-maya', theo, '2026-10-06')).toMatch('assigned')
    const forSomeoneElse = test('client-9', '2026-10-06T07:00:00.000Z', {
      input: {
        clientId: 'client-9',
        testedAt: '2026-10-06T07:00:00.000Z',
        product: 'Toner',
        staffId: 'staff-maya',
        notes: '',
      },
    } as Partial<Command>)
    expect(practitionerRefusal(s, 'staff-theo', forSomeoneElse, '2026-10-06')).toMatch('you did')
    // Grace's waiting test was done by Theo; another practitioner on her visit cannot answer it.
    const graceTest = patchTests(s).find((t) => t.clientId === 'client-6')!
    const someoneElses = structuredClone(s)
    someoneElses.patchTests!.find((t) => t.id === graceTest.id)!.staffId = 'staff-maya'
    const result: Command = {
      type: 'patch-test-result',
      patchTestId: graceTest.id,
      outcome: 'reaction',
      notes: '',
    }
    expect(practitionerRefusal(s, 'staff-theo', result, '2026-10-06')).toBeNull()
    expect(practitionerRefusal(someoneElses, 'staff-theo', result, '2026-10-06')).toMatch('you did')
    const view = practitionerView(s, 'staff-theo', '2026-10-06')
    expect(view.appointments.find((a) => a.id === 'visit-gloss-luca')?.patchTest).toMatchObject({
      state: 'needed',
    })
    expect(view.clients.find((c) => c.id === 'client-3')?.patchTests).toEqual([
      expect.objectContaining({ outcome: 'clear', product: 'Gloss toner 9.1 with 2% developer' }),
    ])
  })

  it('changes the rules for the whole studio', () => {
    const s = apply(seed('UK'), {
      type: 'patch-test-settings',
      settings: { hoursBefore: 48, validMonths: 1, remind: true },
    })
    // Ellie's clear test is from 27 September; a one-month rule still covers 8 October.
    expect(visitPatchTest(s, visit(s, 'visit-gloss-ellie'))?.state).toBe('clear')
    expect(
      run(s, {
        type: 'patch-test-settings',
        settings: { hoursBefore: 12, validMonths: 6, remind: true },
      }).ok,
    ).toBe(false)
  })

  it('reminds a booked guest who has no test, once, and stops when one is recorded', () => {
    const s = structuredClone(seed('UK'))
    s.operations = { ...s.operations!, mode: 'local' }
    const plan = planMessages(s, now, []).filter((m) => m.kind === 'patch_test')
    expect(plan.map((m) => `${m.appointmentId}:${m.channel}`).sort()).toEqual([
      'visit-gloss-luca:email',
      'visit-gloss-luca:sms',
    ])
    expect(plan[0].body).toContain('needs a quick patch test at least 48 hours before')
    const recorded = plan.map((m) => ({ ...m, status: 'test' as const }))
    expect(planMessages(s, now, recorded).filter((m) => m.kind === 'patch_test')).toEqual([])
    // Moving the visit a day later does not send the reminder again.
    const moved = structuredClone(s)
    const luca = visit(moved, 'visit-gloss-luca')
    luca.date = addDays(luca.date, 1)
    expect(planMessages(moved, now, recorded).filter((m) => m.kind === 'patch_test')).toEqual([])
    // One that could not go out does not count.
    const failed = recorded.map((m) => ({ ...m, status: 'failed' as const }))
    expect(planMessages(moved, now, failed).filter((m) => m.kind === 'patch_test')).toHaveLength(2)
    const tested = structuredClone(apply(seed('UK'), test('client-9', '2026-10-06T07:30:00.000Z')))
    tested.operations = { ...tested.operations!, mode: 'local' }
    expect(planMessages(tested, now, []).filter((m) => m.kind === 'patch_test')).toEqual([])
    // Too late to do one: nothing is sent within 48 hours of the visit.
    expect(
      planMessages(s, '2026-10-08T11:00:00.000Z', []).filter((m) => m.kind === 'patch_test'),
    ).toEqual([])
    // A reaction needs a new test, so the guest is asked, until a new one is done.
    const withReaction = apply(
      seed('UK'),
      test('client-9', '2026-10-01T10:00:00.000Z', {
        result: { outcome: 'reaction', notes: 'Redness' },
      }),
    )
    const local = (state: BusinessState) => {
      const copy = structuredClone(state)
      copy.operations = { ...copy.operations!, mode: 'local' }
      return copy
    }
    expect(
      planMessages(local(withReaction), now, []).filter((m) => m.kind === 'patch_test'),
    ).toHaveLength(2)
    const retested = apply(withReaction, test('client-9', '2026-10-06T07:30:00.000Z'))
    expect(planMessages(local(retested), now, []).filter((m) => m.kind === 'patch_test')).toEqual(
      [],
    )
    // A new test that has run out by the visit does not stop the reminder.
    const stale = apply(
      apply(
        seed('UK'),
        test('client-9', '2026-02-01T10:00:00.000Z', {
          result: { outcome: 'reaction', notes: '' },
        }),
      ),
      test('client-9', '2026-03-01T10:00:00.000Z'),
    )
    expect(planMessages(local(stale), now, []).filter((m) => m.kind === 'patch_test')).toHaveLength(
      2,
    )
    const off = structuredClone(s)
    off.operations = {
      ...off.operations!,
      patchTests: { hoursBefore: 48, validMonths: 6, remind: false },
    }
    expect(planMessages(off, now, []).filter((m) => m.kind === 'patch_test')).toEqual([])
    expect(composeMessage(s, visit(s, 'visit-gloss-luca'), 'patch_test', 'email').subject).toBe(
      'A quick patch test before your visit to Atelier House',
    )
  })

  it('keeps tests in the client’s export and erasure review', () => {
    const s = seed('UK')
    const file = clientExport(s, 'client-3', {} as never)
    expect(file.patchTests).toEqual([
      expect.objectContaining({ result: 'clear', doneBy: 'Theo Bennett' }),
    ])
    expect(clientExportText(file)).toContain('2026-09-27 · Gloss toner 9.1')
    expect(previewClientExport(file).sections).toContainEqual({ label: 'Patch tests', count: 1 })
    expect(JSON.stringify(erasureReview(s, 'client-3', '2026-10-06'))).toContain('Patch tests')
  })

  it('rejects a test from another studio or for an unknown client', () => {
    const s = structuredClone(seed('UK'))
    s.patchTests![0].organisationId = 'org-elsewhere'
    expect(() => parseState(s, 'UK')).toThrow(/Foreign/)
    const t = structuredClone(seed('UK'))
    t.patchTests![0].clientId = 'client-unknown'
    expect(() => parseState(t, 'UK')).toThrow(/patch test/)
  })
})
