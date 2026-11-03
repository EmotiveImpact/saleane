import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { dispatch } from './commands'
import type { Command } from './commands'
import { DEMO_DATE, parseState } from './model'
import type { BusinessState } from './model'
import { defaultOperations } from './operations'
import { conversations, repliesList } from './inbox'
import { channelsFor, defaultReminderSettings, missedCallTextDue, planMessages } from './reminders'
import { practitionerView } from './practitioner'
import { clientExport } from './privacy'
import {
  numberStop,
  settledKeyword,
  textStopState,
  textStops,
  textWord,
  textsStopped,
} from './textStop'

// Stage 1: a text that is only STOP or START changes the client's own text setting.
const NOW = `${DEMO_DATE}T08:00:00.000Z`
const LATER = `${DEMO_DATE}T09:30:00.000Z`
const ELLIE = '+447700900003'
const STRANGER = '+447700900999'

function text(s: BusinessState, body: string, ref: string, from = ELLIE, at = NOW) {
  const result = dispatch(
    s,
    { type: 'reply-received', channel: 'sms', from, body, providerRef: ref },
    'Text line',
    at,
  )
  if (!result.ok) throw new Error(result.error)
  return result
}
function run(s: BusinessState, command: Command, at = LATER) {
  return dispatch(s, command, 'Ada Owner', at)
}
const client = (s: BusinessState, id: string) => s.clients.find((c) => c.id === id)!
const reply = (s: BusinessState, id: string) => repliesList(s).find((r) => r.id === id)!
/** Ellie and Noor share one mobile number, as a family can. */
function family() {
  const s = seed('UK')
  client(s, 'client-4').phone = '+44 7700 900003'
  return s
}
/** The record as a studio of its own that sends, with Noor's visit booked just now. */
function sendingStudio(from = seed('UK')) {
  const state = structuredClone(from)
  state.operations = {
    ...defaultOperations('local'),
    hours: defaultOperations().hours,
    reminders: { ...defaultReminderSettings, missedCall: true },
  }
  const visit = state.appointments.find((a) => a.id === 'visit-noor')!
  visit.date = '2026-10-08'
  visit.createdAt = '2026-10-06T07:00:00.000Z'
  return { state, visit }
}

describe('reading a keyword', () => {
  it('counts only a whole text, ignoring case, spaces and punctuation after it', () => {
    for (const body of ['STOP', 'stop', '  Stop.  ', 'STOP!!', 'Cancel', 'cancel?', 'END'])
      expect(textWord(body), body).toBe('stop')
    for (const body of ['quit', 'OptOut', 'revoke', 'stopall', 'Unsubscribe.'])
      expect(textWord(body), body).toBe('stop')
    expect(textWord('START')).toBe('start')
    expect(textWord('unstop!')).toBe('start')
    expect(textWord('Yes.')).toBe('yes')
    expect(textWord('help')).toBe('help')
    expect(textWord('Info?')).toBe('help')
    for (const body of [
      "please don't cancel my visit",
      'Stop texting me please',
      'STOP STOP',
      'S T O P',
      'Cancel Thursday',
      '¿STOP',
      '',
      'Yes please, 3pm is fine',
    ])
      expect(textWord(body), body).toBeNull()
  })
})

describe('STOP by text', () => {
  it('turns texts off for everyone on that number, as their own choice, once', () => {
    const s = family()
    const result = text(s, 'Stop.', 'SM-stop')
    const next = result.state
    for (const id of ['client-3', 'client-4'])
      expect(client(next, id)).toMatchObject({ noTextReminders: true, textsStoppedAt: NOW })
    // Email, and email news, are separate choices and stay as they were.
    for (const id of ['client-3', 'client-4']) {
      expect(client(next, id).noEmailReminders).toBe(client(s, id).noEmailReminders)
      expect(client(next, id).marketingConsent).toBe(client(s, id).marketingConsent)
    }
    expect(next.consentRecords).toEqual(s.consentRecords)
    // Their timelines say what they did, when and how.
    const events = next.events.filter((e) => !s.events.some((old) => old.id === e.id))
    expect(events.map((e) => [e.clientId, e.type, e.title, e.actor])).toEqual([
      ['client-3', 'consent', 'Texts turned off', 'Text line'],
      ['client-4', 'consent', 'Texts turned off', 'Text line'],
    ])
    expect(events[0].detail).toContain('Replied STOP by text')
    // Kept, labelled and read: it waits for no answer.
    const kept = reply(next, result.recordId)
    expect(kept).toMatchObject({ body: 'Stop.', keyword: 'stop', readAt: NOW, readBy: 'Text line' })
    expect(settledKeyword(kept)).toBe(true)
    expect(numberStop(next, ELLIE)).toMatchObject({ stoppedAt: NOW, replyId: kept.id })
    // A provider sending the same message again changes nothing at all.
    const again = dispatch(
      next,
      {
        type: 'reply-received',
        channel: 'sms',
        from: ELLIE,
        body: 'Stop.',
        providerRef: 'SM-stop',
      },
      'Text line',
      LATER,
    )
    expect(again.ok && again.state).toBe(next)
  })

  it('never acts on a keyword inside a longer message', () => {
    const s = seed('UK')
    const result = text(s, "Please don't cancel my visit", 'SM-words')
    expect(client(result.state, 'client-3').noTextReminders).toBeUndefined()
    const kept = reply(result.state, result.recordId)
    expect(kept.keyword).toBeUndefined()
    expect(kept.readAt).toBeUndefined()
    expect(result.state.events.at(-1)).toMatchObject({ title: 'Text received' })
    expect(textStops(result.state)).toEqual([])
    // "Cancel" alone is the phone networks' keyword.
    const cancel = text(result.state, 'Cancel', 'SM-cancel')
    expect(client(cancel.state, 'client-3').noTextReminders).toBe(true)
  })

  it('records a number with no client on file, so nothing is texted to it', () => {
    const s = seed('UK')
    const result = text(s, 'STOP', 'SM-stranger', STRANGER)
    expect(textsStopped(result.state, STRANGER)).toBe(true)
    expect(textsStopped(result.state, '+44 7700 900999')).toBe(true)
    expect(reply(result.state, result.recordId)).toMatchObject({ keyword: 'stop' })
    expect(result.state.clients).toEqual(s.clients)
    // A missed call from it gets no text back, even with text-back on.
    const call = {
      id: 'call-1',
      number: STRANGER,
      at: NOW,
      lastAt: NOW,
      calls: 1,
      source: 'phone' as const,
      actor: 'Phone line',
    }
    expect(missedCallTextDue(sendingStudio(s).state, call, NOW)).toBe(true)
    expect(missedCallTextDue(sendingStudio(result.state).state, call, NOW)).toBe(false)
    // START lifts it, as the phone network does.
    const started = text(result.state, 'START', 'SM-stranger-2', STRANGER, LATER)
    expect(textsStopped(started.state, STRANGER)).toBe(false)
    expect(textStops(started.state)[0]).toMatchObject({ stoppedAt: NOW, startedAt: LATER })
    expect(missedCallTextDue(sendingStudio(started.state).state, call, NOW)).toBe(true)
  })

  it('leaves email and the visit plan by email, and plans no text to the number', () => {
    const { state, visit } = sendingStudio()
    const planned = planMessages(state, '2026-10-06T08:00:00.000Z', [])
    expect(planned.filter((m) => m.appointmentId === visit.id).map((m) => m.channel)).toEqual([
      'email',
      'sms',
    ])
    const stopped = sendingStudio(text(seed('UK'), 'STOP', 'SM-noor', '+447700900004').state).state
    expect(channelsFor(stopped, client(stopped, 'client-4'))).toEqual(['email'])
    const after = planMessages(stopped, '2026-10-06T08:00:00.000Z', [])
    expect(after.filter((m) => m.appointmentId === visit.id).map((m) => m.channel)).toEqual([
      'email',
    ])
  })
})

describe('START by text', () => {
  it('turns texts back on only where a STOP turned them off', () => {
    let s = family()
    // Noor's texts were turned off at the desk before anything was texted.
    const desk = run(s, {
      type: 'contact-preferences',
      clientId: 'client-4',
      email: true,
      sms: false,
    })
    if (!desk.ok) throw new Error(desk.error)
    s = desk.state
    const stop = text(s, 'STOP', 'SM-1')
    expect(client(stop.state, 'client-3').textsStoppedAt).toBe(NOW)
    // Already off at the desk, so the STOP is noted but the desk's record is kept.
    expect(client(stop.state, 'client-4').textsStoppedAt).toBeUndefined()
    expect(stop.state.events.at(-1)).toMatchObject({
      clientId: 'client-4',
      title: 'Replied STOP by text',
    })
    const start = text(stop.state, 'start', 'SM-2', ELLIE, LATER)
    const ellie = client(start.state, 'client-3')
    expect(ellie.noTextReminders).toBeUndefined()
    expect(ellie.textsStoppedAt).toBeUndefined()
    const noor = client(start.state, 'client-4')
    expect(noor).toMatchObject({ noTextReminders: true, textsAskedAt: LATER })
    // The team decides for Noor, so this reply waits for them.
    const kept = reply(start.state, start.recordId)
    expect(kept).toMatchObject({ keyword: 'asked' })
    expect(kept.readAt).toBeUndefined()
    expect(textStopState(start.state, noor)).toEqual({ kind: 'asked', at: LATER })
    expect(numberStop(start.state, ELLIE)).toBeUndefined()
    expect(start.state.events.slice(-2).map((e) => [e.clientId, e.title])).toEqual([
      ['client-3', 'Texts turned back on'],
      ['client-4', 'Asked for texts again'],
    ])
  })

  it('treats YES as an ordinary answer unless the number replied STOP', () => {
    const s = seed('UK')
    const yes = text(s, 'Yes', 'SM-yes')
    expect(reply(yes.state, yes.recordId).keyword).toBeUndefined()
    const stopped = text(yes.state, 'STOP', 'SM-stop')
    const again = text(stopped.state, 'yes!', 'SM-yes-2', ELLIE, LATER)
    expect(reply(again.state, again.recordId)).toMatchObject({ keyword: 'start', readAt: LATER })
    expect(client(again.state, 'client-3').noTextReminders).toBeUndefined()
    // START when nothing was off changes nothing and needs no answer.
    const already = text(again.state, 'START', 'SM-start', ELLIE, LATER)
    expect(reply(already.state, already.recordId)).toMatchObject({ keyword: 'already' })
    expect(already.state.clients).toEqual(again.state.clients)
  })

  it('keeps HELP for the team to see and changes nothing', () => {
    const s = seed('UK')
    const help = text(s, 'HELP', 'SM-help')
    const kept = reply(help.state, help.recordId)
    expect(kept.keyword).toBe('help')
    expect(kept.readAt).toBeUndefined()
    expect(help.state.clients).toEqual(s.clients)
  })
})

describe('the desk after a STOP', () => {
  it('turns texts back on only when the team confirms the client asked', () => {
    const stopped = text(seed('UK'), 'STOP', 'SM-1').state
    const ellie = client(stopped, 'client-3')
    expect(textStopState(stopped, ellie)).toEqual({ kind: 'stopped', at: NOW, blocked: true })
    const refused = run(stopped, {
      type: 'contact-preferences',
      clientId: 'client-3',
      email: true,
      sms: true,
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('Ellie replied STOP by text')
    // Changing only email needs no confirmation.
    expect(
      run(stopped, { type: 'contact-preferences', clientId: 'client-3', email: false, sms: false })
        .ok,
    ).toBe(true)
    const on = run(stopped, {
      type: 'contact-preferences',
      clientId: 'client-3',
      email: true,
      sms: true,
      askedAfterStop: true,
    })
    if (!on.ok) throw new Error(on.error)
    const after = client(on.state, 'client-3')
    expect(after.noTextReminders).toBeUndefined()
    expect(after.textsStoppedAt).toBeUndefined()
    expect(on.state.events.at(-1)).toMatchObject({
      type: 'consent',
      title: 'Visit messages updated',
    })
    expect(on.state.events.at(-1)!.detail).toContain('They replied STOP by text on 6 October')
    expect(on.state.events.at(-1)!.detail).toContain(
      'stays blocked for texts until they text START',
    )
    // The number itself still replied STOP, so nothing is texted to it until START.
    expect(textStopState(on.state, after)).toEqual({ kind: 'number', at: NOW })
    expect(channelsFor(on.state, after)).toEqual(['email'])
  })

  it('refuses to approve a text to a number that replied STOP', () => {
    const stopped = text(seed('UK'), 'STOP', 'SM-1').state
    const draft = (s: BusinessState) =>
      run(s, {
        type: 'message',
        input: {
          clientId: 'client-3',
          purpose: 'appointment',
          channel: 'sms',
          subject: 'Thursday',
          body: 'We can move you to 10:30.',
        },
        approve: true,
      })
    const refused = draft(stopped)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('replied STOP by text')
    const on = run(stopped, {
      type: 'contact-preferences',
      clientId: 'client-3',
      email: true,
      sms: true,
      askedAfterStop: true,
    })
    if (!on.ok) throw new Error(on.error)
    const still = draft(on.state)
    expect(still.ok).toBe(false)
    if (!still.ok) expect(still.error).toContain('until they text START')
    // By email it goes as normal.
    const email = run(on.state, {
      type: 'message',
      input: {
        clientId: 'client-3',
        purpose: 'appointment',
        channel: 'email',
        subject: 'Thursday',
        body: 'We can move you to 10:30.',
      },
      approve: true,
    })
    expect(email.ok).toBe(true)
  })
})

describe('who sees it', () => {
  it('shows in the Inbox without waiting, and in the client export’s permission history', () => {
    const s = seed('UK')
    const before = conversations(s).find((c) => c.clientId === 'client-3')!
    const stopped = text(s, 'STOP', 'SM-1').state
    const thread = conversations(stopped).find((c) => c.clientId === 'client-3')!
    expect(thread.items.at(-1)).toMatchObject({ kind: 'reply', reply: { keyword: 'stop' } })
    expect(thread.unread).toBe(before.unread)
    const file = clientExport(stopped, 'client-3', { generatedAt: LATER, generatedBy: 'Ada' })
    expect(file.consent.history.at(-1)).toMatchObject({ change: 'Texts turned off' })
  })

  it('never reaches a practitioner’s view, which has no contact details', () => {
    const stopped = text(seed('UK'), 'STOP', 'SM-1').state
    const staffId = stopped.appointments.find((a) => a.clientId === 'client-3')!.staffId
    const view = JSON.stringify(practitionerView(stopped, staffId, DEMO_DATE))
    expect(view).not.toContain('textStops')
    expect(view).not.toContain('textsStoppedAt')
    expect(view).not.toContain('noTextReminders')
    expect(view).not.toContain(ELLIE)
  })

  it('refuses a record with the same number twice', () => {
    const stopped = text(seed('UK'), 'STOP', 'SM-1').state
    const broken = structuredClone(stopped)
    broken.textStops = [...broken.textStops!, { ...broken.textStops![0] }]
    expect(() => parseState(broken, 'UK')).toThrow()
  })
})
