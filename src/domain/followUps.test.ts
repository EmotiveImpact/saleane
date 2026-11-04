import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, operations, permissionFor } from './operations'
import { followUpsDue, lifeEventRefusal, lifeEventsFor } from './followUps'
import { eraseClient } from './retentionDue'

// Birthday and life-event follow-ups: drafts to approve, never sent by themselves, never built
// from health details. Fictional seed studio only.
const NOW = '2026-10-06T12:00:00.000Z'
let sequence = 0
function run(s: BusinessState, command: Command, at = NOW) {
  const result = execute(s, command, at, () => `fu-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result
}
const refused = (s: BusinessState, command: Command) => {
  const result = execute(s, command, NOW, () => `fu-${++sequence}`)
  return result.ok ? '' : result.error
}
const local = () => seed('UK')
const message = (s: BusinessState, id: string) => operations(s).messages.find((m) => m.id === id)!

describe('life events', () => {
  it('keeps health, medical and bereavement details out', () => {
    for (const label of ['Surgery', 'IVF appointment', 'Chemo finishes', 'Funeral', 'Pregnancy'])
      expect(lifeEventRefusal(label), label).toMatch(/health/)
    for (const label of ['Wedding', 'New job', 'Graduation', 'Passed driving test'])
      expect(lifeEventRefusal(label), label).toBeNull()
    expect(
      refused(local(), {
        type: 'life-event',
        clientId: 'client-1',
        label: 'Hospital stay',
        date: '2026-10-10',
      }),
    ).toMatch(/consultation/)
  })

  it('records a dated event once, and it is erased with the client', () => {
    const s = local()
    const command: Command = {
      type: 'life-event',
      clientId: 'client-1',
      label: 'Wedding',
      date: '2026-10-10',
    }
    const first = run(s, command)
    const again = run(first.state, { ...command, label: 'wedding' })
    expect(again.recordId).toBe(first.recordId)
    expect(lifeEventsFor(again.state, 'client-1').map((e) => e.label)).toEqual(['Wedding'])
    expect(first.state.events.at(-1)).toMatchObject({ title: 'Life event recorded' })
    const erased = structuredClone(again.state)
    eraseClient(erased, 'client-1', NOW)
    expect(lifeEventsFor(erased, 'client-1')).toEqual([])
  })
})

describe('follow-up drafts', () => {
  it('suggests events in the window only for guests who agreed, and writes a draft once', () => {
    let s = local()
    s = run(s, {
      type: 'life-event',
      clientId: 'client-1',
      label: 'Wedding',
      date: '2026-10-10',
    }).state
    s = run(s, {
      type: 'life-event',
      clientId: 'client-1',
      label: 'New job',
      date: '2026-12-01',
    }).state
    const wedding = lifeEventsFor(s, 'client-1').find((e) => e.label === 'Wedding')!
    const due = followUpsDue(s, NOW).filter((f) => f.kind === 'event')
    expect(due.map((f) => f.title)).toEqual(['Wedding'])
    const drafted = run(s, { type: 'follow-up-draft', clientId: 'client-1', about: wedding.id })
    const m = message(drafted.state, drafted.recordId!)
    expect(m).toMatchObject({ status: 'draft', purpose: 'marketing', channel: 'email' })
    expect(m.approvedAt).toBeUndefined()
    expect(m.body).toContain('your wedding on')
    expect(m.body).not.toMatch(/%/)
    const again = run(drafted.state, {
      type: 'follow-up-draft',
      clientId: 'client-1',
      about: wedding.id,
    })
    expect(again.recordId).toBe(drafted.recordId)
    expect(operations(again.state).messages.filter((x) => x.followUp)).toHaveLength(1)
    expect(followUpsDue(again.state, NOW).find((f) => f.about === wedding.id)?.messageId).toBe(
      drafted.recordId,
    )
    // Too early for the job, and no draft for someone who did not agree.
    const job = lifeEventsFor(s, 'client-1').find((e) => e.label === 'New job')!
    expect(refused(s, { type: 'follow-up-draft', clientId: 'client-1', about: job.id })).toMatch(
      /days before/,
    )
    const quiet = structuredClone(s)
    quiet.clients.find((c) => c.id === 'client-1')!.marketingConsent = false
    expect(followUpsDue(quiet, NOW).filter((f) => f.clientId === 'client-1')).toEqual([])
    expect(
      refused(quiet, { type: 'follow-up-draft', clientId: 'client-1', about: wedding.id }),
    ).toMatch(/not agreed/)
  })

  it('never reads notes or health details into the words', () => {
    let s = local()
    const client = s.clients.find((c) => c.id === 'client-1')!
    client.preferences = 'Allergic to nuts; recovering from surgery'
    s = run(s, {
      type: 'life-event',
      clientId: 'client-1',
      label: 'Graduation',
      date: '2026-10-08',
    }).state
    const event = lifeEventsFor(s, 'client-1')[0]
    const drafted = run(s, { type: 'follow-up-draft', clientId: 'client-1', about: event.id })
    const m = message(drafted.state, drafted.recordId!)
    expect(`${m.subject} ${m.body}`).not.toMatch(/nuts|surgery|allerg/i)
  })

  it('lets only the owner add a gentle offer, and approval still needs agreement', () => {
    const s = local()
    const birthday: Command = {
      type: 'follow-up-draft',
      clientId: 'client-1',
      about: 'birthday',
      percent: 10,
    }
    expect(permissionFor(birthday)).toBe('quiet-offers')
    expect(can('owner', permissionFor(birthday))).toBe(true)
    expect(can('manager', permissionFor(birthday))).toBe(false)
    expect(can('manager', permissionFor({ ...birthday, percent: undefined } as Command))).toBe(true)
    const drafted = run(s, birthday)
    const m = message(drafted.state, drafted.recordId!)
    expect(m.subject).toMatch(/Happy birthday/)
    expect(m.body).toContain('take 10% off your next treatment')
    expect(m.followUp).toMatchObject({
      kind: 'birthday',
      key: '2026',
      percent: 10,
      until: '2026-11-05',
    })
    // Withdrawn agreement before approval: the existing approval check refuses it.
    const withdrawn = structuredClone(drafted.state)
    withdrawn.clients.find((c) => c.id === 'client-1')!.marketingConsent = false
    expect(refused(withdrawn, { type: 'message-queue', messageId: m.id })).toMatch(/not agreed/)
    const approved = run(drafted.state, { type: 'message-queue', messageId: m.id })
    expect(message(approved.state, m.id).status).toBe('queued')
    // Once approved it is settled, and the birthday is not written again.
    expect(refused(approved.state, { ...birthday, percent: 15 })).toBe('')
    expect(operations(approved.state).messages.filter((x) => x.followUp)).toHaveLength(1)
  })

  it('stops suggesting birthdays when the owner switches them off', () => {
    const s = local()
    s.operations!.reminders = { ...s.operations!.reminders!, birthday: false }
    expect(followUpsDue(s, NOW).filter((f) => f.kind === 'birthday')).toEqual([])
    expect(
      refused(s, { type: 'follow-up-draft', clientId: 'client-1', about: 'birthday' }),
    ).toMatch(/switched off/)
  })
})
