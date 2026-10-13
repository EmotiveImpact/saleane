import { describe, expect, it } from 'vitest'
import { seed } from './seed'
import { DEMO_DATE } from './model'
import type { Appointment, BusinessState } from './model'
import {
  AWAY_MINUTES,
  birthdayOn,
  chooseWelcome,
  countedVisits,
  dayEnds,
  rememberWelcome,
  visitsInYear,
  welcomeWords,
} from './welcomeScene'
import type { WelcomeMoment } from './welcomeScene'

const NOW = Date.UTC(2026, 9, 6, 9, 0)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A visit on the sample day, from a sample visit, at a time and in a state of our choosing. */
function visit(
  base: Appointment,
  id: string,
  start: number,
  status: Appointment['status'],
  minutes = 60,
): Appointment {
  return {
    ...base,
    id,
    date: DEMO_DATE,
    startMinutes: start,
    status,
    bookedDurationMinutes: minutes,
  }
}

/** The sample studio with its day replaced by `day`. */
function studio(day: (base: Appointment) => Appointment[]): BusinessState {
  const s = seed('UK')
  const base = s.appointments[0]
  return {
    ...s,
    appointments: [...s.appointments.filter((a) => a.date !== DEMO_DATE), ...day(base)],
  }
}

const moment = (over: Partial<WelcomeMoment> = {}): WelcomeMoment => ({
  now: NOW,
  today: DEMO_DATE,
  minutes: 9 * 60,
  day: [],
  memory: {},
  ...over,
})

describe('choosing the welcome', () => {
  it('plays the first open of the day once, then nothing until an hour away', () => {
    expect(chooseWelcome(moment())).toBe('morning')
    const after = rememberWelcome({}, 'morning', moment())
    expect(after).toMatchObject({ opened: true, morning: DEMO_DATE, lastSeen: NOW })
    // Opening again a few minutes later plays nothing.
    expect(chooseWelcome(moment({ now: NOW + 5 * 60 * 1000, memory: after }))).toBeNull()
    // An hour or more away, it says welcome back.
    expect(chooseWelcome(moment({ now: NOW + AWAY_MINUTES * 60 * 1000, memory: after }))).toBe(
      'back',
    )
    expect(
      chooseWelcome(moment({ now: NOW + AWAY_MINUTES * 60 * 1000 - 1, memory: after })),
    ).toBeNull()
    // The next day is a new first open.
    expect(chooseWelcome(moment({ today: '2026-10-07', memory: after }))).toBe('morning')
  })

  it('greets someone new with the doors, once, while the account or studio is new', () => {
    expect(chooseWelcome(moment({ accountMadeAt: NOW - HOUR }))).toBe('first')
    expect(chooseWelcome(moment({ studioMadeAt: NOW - 6 * DAY }))).toBe('first')
    // Already opened here: the doors never open twice.
    expect(chooseWelcome(moment({ accountMadeAt: NOW - HOUR, memory: { opened: true } }))).toBe(
      'morning',
    )
    // An established account and studio on a new device is simply the first open of the day.
    expect(
      chooseWelcome(moment({ accountMadeAt: NOW - 30 * DAY, studioMadeAt: NOW - 400 * DAY })),
    ).toBe('morning')
  })

  it('closes up only once the day’s last visit has ended, late in the day, once', () => {
    const s = studio((base) => [
      visit(base, 'a', 9 * 60, 'completed'),
      visit(base, 'b', 16 * 60, 'completed', 90),
    ])
    const day = countedVisits(s.appointments, DEMO_DATE)
    expect(dayEnds(day)).toBe(17 * 60 + 30)
    expect(chooseWelcome(moment({ day, minutes: 17 * 60 + 29 }))).toBe('morning')
    expect(chooseWelcome(moment({ day, minutes: 17 * 60 + 30 }))).toBe('evening')
    const after = rememberWelcome({}, 'evening', moment({ day, minutes: 18 * 60 }))
    expect(after.morning).toBe(DEMO_DATE)
    expect(chooseWelcome(moment({ day, minutes: 19 * 60, memory: after }))).toBeNull()
    // A quiet day ending at noon does not close up at one o'clock.
    const early = countedVisits(
      studio((base) => [visit(base, 'c', 10 * 60, 'completed')]).appointments,
      DEMO_DATE,
    )
    expect(chooseWelcome(moment({ day: early, minutes: 13 * 60 }))).toBe('morning')
    // With nothing booked there is nothing to close up.
    expect(chooseWelcome(moment({ minutes: 20 * 60 }))).toBe('morning')
  })

  it('celebrates the studio’s birthday at the first open on or just after it, once a year', () => {
    const joinedOn = '2025-10-04'
    expect(birthdayOn(joinedOn, '2026-10-03')).toBeNull()
    expect(birthdayOn(joinedOn, '2026-10-04')).toEqual({ years: 1, on: '2026-10-04' })
    expect(birthdayOn(joinedOn, '2026-10-10')).toEqual({ years: 1, on: '2026-10-04' })
    expect(birthdayOn(joinedOn, '2026-10-11')).toBeNull()
    // Never before the first year is up.
    expect(birthdayOn('2026-10-01', '2026-10-06')).toBeNull()
    // Across the new year.
    expect(birthdayOn('2024-12-30', '2026-01-02')).toEqual({ years: 1, on: '2025-12-30' })
    // A studio that joined on 29 February celebrates on the 28th in other years.
    expect(birthdayOn('2024-02-29', '2025-02-28')).toEqual({ years: 1, on: '2025-02-28' })
    expect(birthdayOn('2024-02-29', '2028-02-29')).toEqual({ years: 4, on: '2028-02-29' })

    expect(chooseWelcome(moment({ joinedOn }))).toBe('birthday')
    const after = rememberWelcome({}, 'birthday', moment({ joinedOn }))
    expect(after.birthday).toBe(1)
    // Not again later that week, even on another day's first open.
    expect(chooseWelcome(moment({ joinedOn, today: '2026-10-07', memory: after }))).toBe('morning')
  })

  it('does not celebrate a birthday the day has already opened without', () => {
    // Opened today already, so the birthday has passed by for this year.
    expect(
      chooseWelcome(moment({ joinedOn: '2025-10-06', memory: { morning: DEMO_DATE } })),
    ).toBeNull()
  })
})

describe('the words on screen', () => {
  const s = studio((base) => [
    visit(base, 'a', 9 * 60 + 30, 'completed'),
    visit(base, 'b', 11 * 60, 'arrived'),
    visit(base, 'c', 14 * 60 + 15, 'confirmed'),
    visit(base, 'x', 15 * 60, 'cancelled'),
  ])
  const at = (minutes: number) => ({ state: s, today: DEMO_DATE, minutes, firstName: 'Amara' })
  const nextGuest = s.clients
    .find((c) => c.id === s.appointments.find((a) => a.id === 'c')!.clientId)!
    .name.split(' ')[0]
  const nextTreatment =
    s.appointments.find((a) => a.id === 'c')!.bookedServiceName ??
    s.services.find((x) => x.id === s.appointments.find((a) => a.id === 'c')!.serviceId)!.name

  it('greets the morning with the day’s real visits, leaving out cancelled ones', () => {
    const fresh = studio((base) => [
      visit(base, 'a', 9 * 60 + 30, 'confirmed'),
      visit(base, 'b', 11 * 60, 'confirmed'),
      visit(base, 'c', 14 * 60 + 15, 'confirmed'),
      visit(base, 'x', 15 * 60, 'cancelled'),
    ])
    const early = welcomeWords('morning', { ...at(8 * 60), state: fresh })
    expect(early.title).toBe('Good morning, Amara')
    expect(early.line).toBe('Three visits today. The first is at 09:30.')
    expect(early.eyebrow).toBe(`${s.organisation.name} · ${s.organisation.locationName}`)
    // Once the first has started, it says who is next instead.
    const later = welcomeWords('morning', at(12 * 60 + 30))
    expect(later.title).toBe('Good afternoon, Amara')
    expect(later.line).toBe(`Three visits today. Next is ${nextGuest} at 14:15, ${nextTreatment}.`)
    // Nobody signed in (the fictional demo): no name.
    expect(welcomeWords('morning', { ...at(8 * 60), firstName: undefined }).title).toBe(
      'Good morning',
    )
  })

  it('says who is next when someone comes back, or that nothing else is booked', () => {
    expect(welcomeWords('back', at(14 * 60)).line).toBe(
      `Next is ${nextGuest} at 14:15, ${nextTreatment}.`,
    )
    expect(welcomeWords('back', at(14 * 60)).eyebrow).toBe(`${s.organisation.name} · 14:00`)
    expect(welcomeWords('back', at(15 * 60)).line).toBe('Nothing else is booked today.')
  })

  it('only calls the day all looked after when every visit is finished', () => {
    const open = welcomeWords('evening', at(18 * 60 + 40))
    expect(open.title).toBe('Good evening, Amara')
    expect(open.figure).toMatchObject({ value: 3, shown: '3', unit: 'visits today' })
    expect(open.figure?.detail).toBe('two still to finish')
    const done = studio((base) => [
      visit(base, 'a', 9 * 60, 'completed'),
      visit(base, 'b', 10 * 60, 'completed'),
    ])
    expect(
      welcomeWords('evening', { state: done, today: DEMO_DATE, minutes: 18 * 60 }).figure?.detail,
    ).toBe('all looked after')
  })

  it('opens the doors to a new studio, or to a new member of an existing one', () => {
    const owner = welcomeWords('first', { ...at(9 * 60), settingUp: true })
    expect(owner.doors).toEqual({ by: 'SALEANE', welcomes: 'welcomes', name: s.organisation.name })
    expect(owner.title).toBe(`${s.organisation.name}, come on in`)
    expect(owner.line).toBe('We’ll set up your studio together, one screen at a time.')
    const member = welcomeWords('first', at(9 * 60))
    expect(member.doors).toEqual({ by: s.organisation.name, welcomes: 'welcomes', name: 'Amara' })
    expect(member.eyebrow).toBe(`Welcome to ${s.organisation.name}`)
    expect(member.title).toBe('Come on in, Amara')
  })

  it('counts the birthday year’s finished visits only', () => {
    const year = seed('UK')
    const words = welcomeWords('birthday', {
      state: year,
      today: DEMO_DATE,
      minutes: 9 * 60,
      joinedOn: '2025-10-06',
    })
    const counted = visitsInYear(year, DEMO_DATE)
    expect(counted).toBe(
      year.appointments.filter(
        (a) => a.status === 'completed' && a.date >= '2025-10-06' && a.date < DEMO_DATE,
      ).length,
    )
    expect(words.figure?.value).toBe(counted)
    expect(words.figure?.shown).toBe(counted.toLocaleString('en-GB'))
    expect(words.eyebrow).toBe(`One year of ${year.organisation.name} on SALEANE`)
    expect(words.figure?.unit).toMatch(/in your first year$/)
    expect(words.thanks).toBe('Thank you for every one.')
  })

  it('never uses an em dash, and says visit and treatment rather than other words', () => {
    for (const scene of ['morning', 'back', 'evening', 'first', 'birthday'] as const) {
      const words = welcomeWords(scene, { ...at(12 * 60), joinedOn: '2025-10-06' })
      const text = JSON.stringify(words)
      expect(text).not.toMatch(/—|appointment|service/i)
    }
  })
})
