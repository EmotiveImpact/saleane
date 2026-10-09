import { describe, expect, it } from 'vitest'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, permissionFor } from './operations'
import { seed } from './seed'
import { branchVisits, checklists, lastVisits, toPutRight, visitScore } from './branchVisits'

// V5: branch visit checklists. The demo studio's business date is 2026-10-06.
const now = '2026-10-06T15:00:00.000Z'
let sequence = 0
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, () => `bv-${++sequence}`)
  if (!result.ok) throw new Error(result.error)
  return result.state
}
const refuse = (s: BusinessState, command: Command) => {
  const result = execute(s, command, now, () => `bv-${++sequence}`)
  if (result.ok) throw new Error('Expected a refusal')
  return result.error
}

function withChecklist() {
  let s = seed('UK')
  s = apply(s, {
    type: 'checklist-save',
    input: {
      name: 'Quick look',
      items: [{ text: 'Door glass is clean' }, { text: 'Music is on' }],
    },
  })
  const list = checklists(s).find((c) => c.name === 'Quick look')!
  return { s, list, place: s.organisation.locationId }
}
const answer = (list: { items: { id: string }[] }, ...answers: ('yes' | 'no' | 'na')[]) =>
  list.items.map((item, i) => ({ itemId: item.id, answer: answers[i] }))

describe('branch visit checklists', () => {
  it('records a visit with the wording of the day, and keeps it when the checklist changes', () => {
    const { s: start, list, place } = withChecklist()
    let s = apply(start, {
      type: 'branch-visit',
      input: {
        locationId: place,
        checklistId: list.id,
        date: '2026-10-06',
        answers: [
          { itemId: list.items[0].id, answer: 'no', note: 'Fingerprints at child height' },
          { itemId: list.items[1].id, answer: 'yes', note: '' },
        ],
        note: 'Busy afternoon.',
      },
    })
    const visit = branchVisits(s).find((v) => v.checklistId === list.id)!
    expect(visit.answers).toEqual([
      {
        itemId: list.items[0].id,
        text: 'Door glass is clean',
        answer: 'no',
        note: 'Fingerprints at child height',
      },
      { itemId: list.items[1].id, text: 'Music is on', answer: 'yes' },
    ])
    expect(visitScore(visit)).toEqual({ yes: 1, no: 1, na: 0, open: 1 })
    // Rewording a line later leaves the recorded visit as it was answered.
    s = apply(s, {
      type: 'checklist-save',
      id: list.id,
      input: {
        name: 'Quick look',
        items: [
          { id: list.items[0].id, text: 'Door and windows are clean' },
          { text: 'Lights on' },
        ],
      },
    })
    expect(
      checklists(s)
        .find((c) => c.id === list.id)!
        .items.map((i) => i.text),
    ).toEqual(['Door and windows are clean', 'Lights on'])
    expect(branchVisits(s).find((v) => v.id === visit.id)!.answers[0].text).toBe(
      'Door glass is clean',
    )
    expect(lastVisits(s)[0].visit?.id).toBe(visit.id)
  })

  it('keeps a "no" on the list to put right until someone marks it done', () => {
    const { s: start, list, place } = withChecklist()
    let s = apply(start, {
      type: 'branch-visit',
      input: {
        locationId: place,
        checklistId: list.id,
        date: '2026-10-05',
        answers: answer(list, 'no', 'na'),
      },
    })
    const visit = branchVisits(s).find((v) => v.checklistId === list.id)!
    const open = toPutRight(s)
    // The demo visit's empty shelf and this door glass.
    expect(open.map((o) => o.line.text)).toEqual([
      'Door glass is clean',
      'Retail shelves are full, priced and dusted',
    ])
    expect(
      refuse(s, { type: 'branch-visit-fix', visitId: visit.id, itemId: list.items[1].id }),
    ).toMatch(/Only a line answered no/)
    const result = dispatch(
      s,
      { type: 'branch-visit-fix', visitId: visit.id, itemId: list.items[0].id },
      'Edem · owner',
      now,
    )
    if (!result.ok) throw new Error(result.error)
    s = result.state
    const fixed = branchVisits(s).find((v) => v.id === visit.id)!.answers[0].fixed
    expect(fixed).toEqual({ on: '2026-10-06', at: now, actor: 'Edem · owner' })
    expect(toPutRight(s)).toHaveLength(1)
    expect(
      refuse(s, { type: 'branch-visit-fix', visitId: visit.id, itemId: list.items[0].id }),
    ).toMatch(/already been put right/)
  })

  it('needs every line answered, a real open location, and a date that has happened', () => {
    const { s, list, place } = withChecklist()
    const visit = (
      input: Partial<Extract<Command, { type: 'branch-visit' }>['input']>,
    ): Command => ({
      type: 'branch-visit',
      input: {
        locationId: place,
        checklistId: list.id,
        date: '2026-10-06',
        answers: answer(list, 'yes', 'yes'),
        ...input,
      },
    })
    expect(refuse(s, visit({ answers: answer(list, 'yes').slice(0, 1) }))).toMatch(
      /Answer every line/,
    )
    expect(refuse(s, visit({ date: '2026-10-07' }))).toMatch(/once it has happened/)
    expect(refuse(s, visit({ date: '2026-08-01' }))).toMatch(/within 31 days/)
    expect(refuse(s, visit({ locationId: 'nowhere' }))).toMatch(/not open/)
    const put = apply(s, { type: 'checklist-archive', checklistId: list.id, archived: true })
    expect(refuse(put, visit({}))).toMatch(/not in use/)
    // Putting a checklist away keeps it, so past visits still name it.
    expect(checklists(put).find((c) => c.id === list.id)?.archived).toBe(true)
    expect(
      refuse(s, {
        type: 'checklist-save',
        input: { name: 'quick look', items: [{ text: 'Anything' }] },
      }),
    ).toMatch(/already has that name/)
    expect(
      refuse(s, {
        type: 'checklist-save',
        input: { name: 'Twice', items: [{ text: 'Same line' }, { text: 'same line' }] },
      }),
    ).toMatch(/Each line/)
  })

  it('is for the owner and managers only', () => {
    for (const type of [
      'checklist-save',
      'checklist-archive',
      'branch-visit',
      'branch-visit-fix',
    ]) {
      const action = permissionFor({ type })
      expect(can('owner', action)).toBe(true)
      expect(can('manager', action)).toBe(true)
      expect(can('reception', action)).toBe(false)
      expect(can('practitioner', action)).toBe(false)
    }
  })
})
