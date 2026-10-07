import { describe, expect, it } from 'vitest'
import { dispatch } from './commands'
import type { BusinessState } from './model'
import { nudges } from './nudges'
import { can, permissionFor } from './operations'
import { seed } from './seed'
import { dueTasks, openTasks } from './tasks'

const today = '2026-10-06'
const at = '2026-10-06T09:00:00.000Z'

function remind(s: BusinessState, text: string, dueDate: string) {
  const result = dispatch(s, { type: 'task-add', input: { text, dueDate } }, 'Maya Lewis', at)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('reminders', () => {
  it('keeps a reminder for its day, with who left it, until it is ticked off', () => {
    let s = remind(seed('UK'), 'Call the supplier', '2026-10-09')
    s = remind(s, 'Order towels', today)
    expect(dueTasks(s, today).map((t) => t.text)).toEqual(['Order towels'])
    expect(dueTasks(s, '2026-10-10').map((t) => t.text)).toEqual([
      'Order towels',
      'Call the supplier',
    ])
    const towels = openTasks(s).find((t) => t.text === 'Order towels')!
    expect(towels.createdBy).toBe('Maya Lewis')
    const done = dispatch(s, { type: 'task-done', taskId: towels.id }, 'Maya Lewis', at)
    if (!done.ok) throw new Error(done.error)
    expect(dueTasks(done.state, today)).toEqual([])
    const again = dispatch(done.state, { type: 'task-done', taskId: towels.id }, 'Maya Lewis', at)
    expect(again.ok && again.state).toBe(done.state)
  })

  it('refuses a day that has passed, and is for the desk, not practitioners', () => {
    const past = dispatch(
      seed('UK'),
      { type: 'task-add', input: { text: 'Too late', dueDate: '2026-10-01' } },
      'Maya',
      at,
    )
    expect(past.ok).toBe(false)
    const permission = permissionFor({ type: 'task-add' })
    expect(can('reception', permission)).toBe(true)
    expect(can('practitioner', permission)).toBe(false)
  })
})

describe('what Ask Saleane mentions first', () => {
  it('mentions a waitlist time free soon, reminders and anything unusual, at most three', () => {
    const s = remind(seed('UK'), 'Order towels', today)
    const list = nudges(s, 'owner', today, at)
    expect(list.length).toBeLessThanOrEqual(3)
    expect(list[0]).toMatchObject({
      text: expect.stringMatching(
        /^Charlotte Hayes is waiting for Skin Renewal Facial, and Maya is free today at 12:15\./,
      ),
      ask: 'Offer Charlotte today at 12:15',
    })
    expect(list.some((n) => n.text === 'A reminder for today: Order towels.')).toBe(true)
  })

  it('says nothing to practitioners', () => {
    expect(nudges(seed('UK'), 'practitioner', today, at)).toEqual([])
  })
})
