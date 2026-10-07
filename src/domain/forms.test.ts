import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch, execute } from './commands'
import type { Command } from './commands'
import type { BusinessState } from './model'
import { can, defaultOperations } from './operations'
import { formsWaiting, healthWord, visitAnswers, visitForms } from './forms'
import type { FormContent } from './formsSchema'
import { guestView } from './guest'
import { composeMessage } from './reminders'
import { clientExport, erasureReview } from './privacy'

// V1.5: ordinary guest forms, filled in from the private link before a visit.
let sequence = 0
const makeId = () => `form-${++sequence}`
const NOW = '2026-10-06T08:00:00.000Z'
function run(s: BusinessState, command: Command, now = NOW) {
  const result = execute(s, command, now, makeId)
  if (!result.ok) throw new Error(result.error)
  return result
}
const content: FormContent = {
  title: 'Welcome',
  intro: 'So we are ready for you.',
  questions: [
    {
      id: 'q-heard',
      kind: 'choice',
      label: 'How did you find us?',
      required: true,
      options: ['A friend', 'Instagram', 'Google'],
    },
    { id: 'q-quiet', kind: 'yes_no', label: 'Would you like a quiet visit?', required: false },
    { id: 'q-notes', kind: 'long', label: 'Anything else?', required: false },
  ],
  agreement: 'I have read the cancellation policy.',
}
/** A real studio with no sample forms, plus one welcome form for every service. */
function local(when: 'once' | 'every_visit' = 'every_visit') {
  const state = seed('UK')
  Object.assign(state, { sales: [], payments: [], counterSales: [], giftCards: [], holdings: [] })
  state.events = state.events.filter((e) => !e.saleId)
  state.operations = { ...defaultOperations('local'), hours: defaultOperations().hours }
  state.forms = []
  state.formResponses = []
  const saved = run(state, { type: 'form-save', content, settings: { serviceIds: [], when } })
  return { s: saved.state, formId: saved.recordId! }
}
const upcoming = (s: BusinessState, clientId?: string) =>
  s.appointments.find((a) => a.status === 'confirmed' && (!clientId || a.clientId === clientId))!
const submit = (appointmentId: string, formId: string, extra: Partial<Command> = {}) =>
  ({
    type: 'form-submit',
    appointmentId,
    formId,
    version: 1,
    answers: [
      { questionId: 'q-heard', value: 'Instagram' },
      { questionId: 'q-quiet', value: 'yes' },
      { questionId: 'q-notes', value: 'Ring the bell twice' },
    ],
    agreedName: 'Noor Ahmed',
    ...extra,
  }) as Command

describe('guest forms', () => {
  it('refuses health questions, so forms never collect them', () => {
    expect(healthWord(content)).toBeNull()
    const ask = (label: string) =>
      healthWord({ ...content, questions: [{ id: 'q', kind: 'short', label, required: false }] })
    expect(ask('Do you have any allergies?')).toBe('allergies')
    expect(ask('Are you pregnant?')).toBe('pregnant')
    expect(ask('Any medical conditions we should know about?')).toMatch(/medical/i)
    expect(ask('Are you taking any medication?')).toBe('medication')
    expect(ask('How would you like your hair to feel?')).toBeNull()
    const { s } = local()
    const refused = execute(
      s,
      {
        type: 'form-save',
        content: { ...content, intro: 'Tell us about any allergies.' },
        settings: { serviceIds: [], when: 'once' },
      },
      NOW,
      makeId,
    )
    expect(refused.ok || refused.error).toMatch(/cannot ask about health/)
  })

  it('asks for a form before the visit and takes one answer through the guest', () => {
    const { s, formId } = local()
    const a = upcoming(s)
    expect(formsWaiting(s, a).map((item) => item.form.id)).toEqual([formId])
    const view = guestView(s, a.id, Date.parse(NOW))
    expect(view.forms).toEqual([{ formId, version: 1, content, done: false }])
    const sent = dispatch(s, submit(a.id, formId), 'Guest (private link)', NOW)
    if (!sent.ok) throw new Error(sent.error)
    expect(formsWaiting(sent.state, a)).toEqual([])
    expect(guestView(sent.state, a.id, Date.parse(NOW)).forms?.[0].done).toBe(true)
    // The view tells the guest it arrived, never their answers.
    expect(JSON.stringify(guestView(sent.state, a.id, Date.parse(NOW)))).not.toContain(
      'Ring the bell',
    )
    const [given] = visitAnswers(sent.state, a.id)
    expect(given.response).toMatchObject({ version: 1, agreedName: 'Noor Ahmed' })
    expect(given.response.answers).toEqual([
      { questionId: 'q-heard', value: 'Instagram' },
      { questionId: 'q-quiet', value: 'yes' },
      { questionId: 'q-notes', value: 'Ring the bell twice' },
    ])
    const event = sent.state.events.find((e) => e.type === 'form')!
    expect(event).toMatchObject({ appointmentId: a.id, actor: 'Guest (private link)' })
    // The same answers again change nothing; different ones cannot replace them.
    const again = execute(sent.state, submit(a.id, formId), NOW, makeId)
    expect(again.ok && again.state).toBe(sent.state)
    const changed = execute(
      sent.state,
      submit(a.id, formId, { agreedName: 'Someone Else' } as Partial<Command>),
      NOW,
      makeId,
    )
    expect(changed.ok || changed.error).toMatch(/already with the studio/)
  })

  it('checks every answer against the questions', () => {
    const { s, formId } = local()
    const a = upcoming(s)
    const tryWith = (extra: Record<string, unknown>) => {
      const result = execute(s, submit(a.id, formId, extra as Partial<Command>), NOW, makeId)
      return result.ok ? 'ok' : result.error
    }
    expect(tryWith({ answers: [] })).toMatch(/How did you find us/)
    expect(tryWith({ answers: [{ questionId: 'q-heard', value: 'TikTok' }] })).toMatch(/choose one/)
    expect(
      tryWith({
        answers: [
          { questionId: 'q-heard', value: 'Google' },
          { questionId: 'q-quiet', value: 'maybe' },
        ],
      }),
    ).toMatch(/yes or no/)
    expect(tryWith({ agreedName: '' })).toBe('Type your name to agree.')
    expect(tryWith({ version: 2 })).toMatch(/changed this form/)
    expect(tryWith({ answers: [{ questionId: 'q-other', value: 'x' }] })).toMatch(/check the form/)
  })

  it('takes a form only before the visit starts', () => {
    const { s, formId } = local()
    const a = upcoming(s)
    const late = execute(s, submit(a.id, formId), '2026-10-30T08:00:00.000Z', makeId)
    expect(late.ok || late.error).toBe('Forms can be filled in before the visit only.')
    expect(guestView(s, a.id, Date.parse('2026-10-30T08:00:00.000Z')).forms).toBeUndefined()
  })

  it('keeps to the limit of forms in use when one is asked for again', () => {
    const start = local()
    const { formId } = start
    let s = start.s
    s = run(s, { type: 'form-archive', formId, archived: true }).state
    for (let i = 0; i < 30; i++)
      s = run(s, {
        type: 'form-save',
        content: { ...content, title: `Form ${i}` },
        settings: { serviceIds: [], when: 'once' },
      }).state
    const again = execute(s, { type: 'form-archive', formId, archived: false }, NOW, makeId)
    expect(again.ok || again.error).toMatch(/up to 30 forms/)
  })

  it('makes a new version when the words change, and keeps old answers on theirs', () => {
    const { s, formId } = local()
    const a = upcoming(s)
    const sent = run(s, submit(a.id, formId))
    const same = run(sent.state, {
      type: 'form-save',
      id: formId,
      content,
      settings: { serviceIds: [], when: 'every_visit' },
    })
    expect(same.state.forms![0].versions).toHaveLength(1)
    const edited = dispatch(
      sent.state,
      {
        type: 'form-save',
        id: formId,
        content: { ...content, title: 'Welcome to the studio' },
        settings: { serviceIds: ['service-cut'], when: 'every_visit' },
      },
      'Ada',
      NOW,
    )
    if (!edited.ok) throw new Error(edited.error)
    const form = edited.state.forms![0]
    expect(form.versions.map((v) => [v.version, v.publishedBy])).toEqual([
      [1, ''],
      [2, 'Ada'],
    ])
    expect(visitAnswers(edited.state, a.id)[0].content.title).toBe('Welcome')
  })

  it('asks a once-only form a single time per guest', () => {
    const { s, formId } = local('once')
    const visits = s.appointments.filter((a) => a.status === 'confirmed')
    const first = visits[0]
    const second = visits.find((a) => a.clientId === first.clientId && a.id !== first.id)
    const sent = run(s, submit(first.id, formId))
    expect(visitForms(sent.state, first)[0].answer).toBeDefined()
    if (second) expect(formsWaiting(sent.state, second)).toEqual([])
    const other = visits.find((a) => a.clientId !== first.clientId)!
    expect(formsWaiting(sent.state, other)).toHaveLength(1)
  })

  it('only asks for forms that cover the service, and stops when archived', () => {
    const { s, formId } = local()
    const cut = run(s, {
      type: 'form-save',
      id: formId,
      content,
      settings: { serviceIds: ['service-cut'], when: 'every_visit' },
    }).state
    const facial = cut.appointments.find(
      (a) => a.status === 'confirmed' && a.serviceId === 'service-facial',
    )!
    expect(formsWaiting(cut, facial)).toEqual([])
    const haircut = cut.appointments.find(
      (a) => a.status === 'confirmed' && a.serviceId === 'service-cut',
    )!
    expect(formsWaiting(cut, haircut)).toHaveLength(1)
    const off = run(cut, { type: 'form-archive', formId, archived: true }).state
    expect(formsWaiting(off, haircut)).toEqual([])
    expect(execute(off, submit(haircut.id, formId), NOW, makeId).ok).toBe(false)
  })

  it('mentions a waiting form in the confirmation, and nothing once it is in', () => {
    const { s, formId } = local()
    const a = upcoming(s)
    expect(composeMessage(s, a, 'confirmation', 'email').body).toContain(
      'please fill in a short form (Welcome)',
    )
    expect(composeMessage(s, a, 'reminder', 'sms').body).toContain('fill in a short form')
    const sent = run(s, submit(a.id, formId)).state
    expect(composeMessage(sent, a, 'confirmation', 'email').body).not.toContain('short form')
  })

  it('goes in the client export and erasure review, and only the guest can send one', () => {
    const { s, formId } = local()
    const a = upcoming(s)
    const sent = run(s, submit(a.id, formId)).state
    const file = clientExport(sent, a.clientId, { generatedAt: NOW, generatedBy: 'Ada' })
    expect(file.forms).toEqual([
      expect.objectContaining({
        form: 'Welcome',
        version: 1,
        agreedAs: 'Noor Ahmed',
        answers: expect.arrayContaining([
          { question: 'How did you find us?', answer: 'Instagram' },
        ]),
      }),
    ])
    expect(
      erasureReview(sent, a.clientId, '2026-10-06').kept.some(
        (row) => row.label === 'Forms they filled in',
      ),
    ).toBe(true)
    for (const role of ['owner', 'manager', 'reception', 'practitioner'] as const)
      expect(can(role, 'form-submit')).toBe(false)
    expect(can('manager', 'forms')).toBe(true)
    expect(can('reception', 'forms')).toBe(false)
  })

  it('ships a sample form for haircuts with one answer already in', () => {
    const s = seed('UK')
    const grace = s.appointments.find((a) => a.id === 'visit-grace')!
    expect(visitForms(s, grace)[0].answer?.id).toBe('form-answer-1')
    const luca = s.appointments.find((a) => a.id === 'visit-luca')!
    expect(formsWaiting(s, luca)).toHaveLength(1)
  })
})
