import { describe, expect, it } from 'vitest'
import { addDays } from './format'
import { clientInsight } from './clientInsight'
import { operations } from './operations'
import { patchTestSettings } from './patchTests'
import type { BusinessState } from './model'
import {
  FAVOURITE_FROM,
  USUAL_AHEAD_DAYS,
  bookedAhead,
  clearFavourite,
  guestBackground,
  guestUsual,
  nextUsualDate,
  strongPattern,
  usualPattern,
} from './usual'
import { textingGuest, textingRecords } from './textingGuest'
import {
  SATURDAY,
  TODAY,
  addClient,
  addVisit,
  monthlyRegular,
  studio,
} from '../test/clientInsightStudio'

// Stage 5: "my usual", worked out once for the client page, the AI receptionist, the guest's
// visit page and Ask SALEANE. TODAY is Friday 9 October 2026; the regulars come on Saturdays.

/** A second location, Islington, where `who` works every day. */
function islington(s: BusinessState, who: string[] = []) {
  s.operations = {
    ...operations(s),
    locations: [{ id: 'islington', name: 'Islington', address: '1 Upper Street, London' }],
  }
  for (const id of who)
    s.staff.find((p) => p.id === id)!.hours = operations(s).hours.map((h) => ({
      ...h,
      locationId: 'islington',
    }))
  return s
}

describe('the rules for a usual', () => {
  it('names a favourite only with three visits, two alike, no tie and at least half', () => {
    expect(FAVOURITE_FROM).toBe(3)
    expect(clearFavourite(['a', 'a'])).toBeUndefined()
    expect(clearFavourite(['a', 'b', 'c'])).toBeUndefined()
    expect(clearFavourite(['a', 'a', 'b'])).toEqual({ id: 'a', visits: 2, of: 3 })
    expect(clearFavourite(['a', 'a', 'b', 'b'])).toBeUndefined()
    expect(clearFavourite(['a', 'a', 'b', 'c', 'd'])).toBeUndefined()
    expect(clearFavourite(['a', 'a', 'b', 'c'])).toEqual({ id: 'a', visits: 2, of: 4 })
    expect(strongPattern([6, 6, 6])).toBeUndefined()
    expect(strongPattern([6, 6, 6, 2])).toBe(6)
    expect(strongPattern([6, 6, 2, 3])).toBeUndefined()
  })

  it('reads the typical start from the usual part of the day, on the usual day when there is one', () => {
    const visit = (date: string, startMinutes: number, serviceId = 'facial') => ({
      serviceId,
      staffId: 'maya',
      locationId: 'main',
      date,
      startMinutes,
    })
    // Saturdays 2026-09-05, 12, 19, 26 in the morning, and one Tuesday evening.
    expect(
      usualPattern([
        visit('2026-09-05', 600),
        visit('2026-09-12', 630),
        visit('2026-09-19', 570),
        visit('2026-09-26', 600),
        visit('2026-09-29', 1080),
      ]),
    ).toEqual({
      visits: 5,
      treatment: { id: 'facial', visits: 5, of: 5 },
      professional: { id: 'maya', visits: 5, of: 5 },
      location: { id: 'main', visits: 5, of: 5 },
      weekday: 6,
      partOfDay: 'morning',
      startMinutes: 600,
    })
    // Mornings on different days: a part of the day, no day, and the middle morning start.
    const mornings = usualPattern([
      visit('2026-09-07', 540),
      visit('2026-09-15', 600),
      visit('2026-09-23', 660),
      visit('2026-10-01', 600),
    ])
    expect(mornings).toMatchObject({ partOfDay: 'morning', startMinutes: 600 })
    expect(mornings).not.toHaveProperty('weekday')
  })

  it('finds the next usual day from when they are due back, on their usual day of the week', () => {
    // Due back on Saturday 31 October: that day.
    expect(nextUsualDate(TODAY, 6, '2026-10-31')).toBe('2026-10-31')
    // Due on a Wednesday: the Saturday after.
    expect(nextUsualDate(TODAY, 6, '2026-10-28')).toBe('2026-10-31')
    // Already due: the first Saturday from tomorrow.
    expect(nextUsualDate(TODAY, 6, '2026-10-01')).toBe('2026-10-10')
    // Never today: from tomorrow at the earliest.
    expect(nextUsualDate(TODAY, 5, TODAY)).toBe('2026-10-16')
    // Too far ahead to look: the first Saturday from tomorrow instead.
    expect(nextUsualDate(TODAY, 6, addDays(TODAY, USUAL_AHEAD_DAYS + 5))).toBe('2026-10-10')
    // No usual day: the due date, or tomorrow.
    expect(nextUsualDate(TODAY, undefined, '2026-10-20')).toBe('2026-10-20')
    expect(nextUsualDate(TODAY, undefined, undefined)).toBe('2026-10-10')
  })
})

describe("a guest's usual", () => {
  it('agrees with the client page for a regular, and adds the next usual day', () => {
    const s = studio()
    const amelia = addClient(s, 'Amelia Carter')
    monthlyRegular(s, amelia.id, SATURDAY, 13)
    const usual = guestUsual(s, amelia.id, TODAY)
    expect(usual).toEqual({
      clientIds: [amelia.id],
      visits: 13,
      lastVisit: SATURDAY,
      treatment: { serviceId: 'facial', name: 'Restorative Facial' },
      professional: { staffId: 'maya', name: 'Maya Lind' },
      weekday: 6,
      partOfDay: 'morning',
      startMinutes: 600,
      // Four weeks after Saturday 3 October.
      nextDate: '2026-10-31',
      changes: [],
    })
    const page = clientInsight(s, amelia, TODAY)
    expect(page.favouriteTreatment?.serviceId).toBe(usual.treatment?.serviceId)
    expect(page.favouriteProfessional?.staffId).toBe(usual.professional?.staffId)
    expect(page.timing).toMatchObject({ weekday: usual.weekday, partOfDay: usual.partOfDay })
  })

  it('needs three completed visits in the last 12 months, and a clear treatment', () => {
    const s = studio()
    const nina = addClient(s, 'Nina Patel')
    addVisit(s, nina.id, addDays(TODAY, -365)) // a day before the year starts
    addVisit(s, nina.id, addDays(TODAY, -60))
    addVisit(s, nina.id, addDays(TODAY, -30))
    addVisit(s, nina.id, addDays(TODAY, -20), { status: 'cancelled' })
    addVisit(s, nina.id, addDays(TODAY, -10), { status: 'no_show' })
    expect(guestUsual(s, nina.id, TODAY)).toMatchObject({ visits: 2, none: 'new' })
    expect(guestUsual(s, nina.id, TODAY)).not.toHaveProperty('treatment')

    const ellie = addClient(s, 'Ellie Brooks')
    addVisit(s, ellie.id, addDays(TODAY, -70), { serviceId: 'facial', staffId: 'maya' })
    addVisit(s, ellie.id, addDays(TODAY, -50), { serviceId: 'massage', staffId: 'theo' })
    addVisit(s, ellie.id, addDays(TODAY, -30), { serviceId: 'facial', staffId: 'theo' })
    addVisit(s, ellie.id, addDays(TODAY, -10), { serviceId: 'massage', staffId: 'maya' })
    expect(guestUsual(s, ellie.id, TODAY)).toMatchObject({ visits: 4, none: 'no-clear-treatment' })

    // Two of three is a usual, and the person they saw twice is who they usually see.
    const ruby = addClient(s, 'Ruby Taylor')
    addVisit(s, ruby.id, addDays(TODAY, -60), { staffId: 'theo' })
    addVisit(s, ruby.id, addDays(TODAY, -40), { serviceId: 'massage', staffId: 'theo' })
    addVisit(s, ruby.id, addDays(TODAY, -20))
    const usual = guestUsual(s, ruby.id, TODAY)
    expect(usual).toMatchObject({
      visits: 3,
      treatment: { serviceId: 'facial' },
      professional: { staffId: 'theo' },
    })
    expect(usual).not.toHaveProperty('none')
    // Three visits are too few for a habit of days.
    expect(usual).not.toHaveProperty('weekday')
  })

  it('reads every record with the same email as one guest, and nobody else', () => {
    const s = studio()
    // Online booking opened a new record each time.
    const one = addClient(s, 'Amelia Carter', { email: 'amelia@example.com' })
    const two = addClient(s, 'Amelia Carter', { email: 'Amelia@Example.com ' })
    const three = addClient(s, 'Amelia C', { email: 'AMELIA@example.com' })
    const other = addClient(s, 'Grace Chen', { email: 'grace@example.com' })
    addVisit(s, one.id, '2026-09-05')
    addVisit(s, two.id, '2026-09-12')
    addVisit(s, three.id, '2026-09-19')
    for (const date of ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'])
      addVisit(s, other.id, date, { serviceId: 'massage', staffId: 'theo' })
    for (const id of [one.id, two.id, three.id]) {
      const usual = guestUsual(s, id, TODAY)
      expect(usual.clientIds.sort()).toEqual([one.id, two.id, three.id].sort())
      expect(usual).toMatchObject({
        visits: 3,
        lastVisit: '2026-09-19',
        treatment: { serviceId: 'facial' },
        professional: { staffId: 'maya' },
      })
    }
    expect(guestUsual(s, other.id, TODAY)).toMatchObject({
      clientIds: [other.id],
      treatment: { serviceId: 'massage' },
      professional: { staffId: 'theo' },
    })
    // The client page keeps reading one record at a time, as before.
    expect(clientInsight(s, one, TODAY).favouriteTreatment).toBeUndefined()
    // Something booked under any of the records counts as booked.
    expect(bookedAhead(s, [one.id, two.id, three.id], TODAY)).toBe(false)
    addVisit(s, three.id, addDays(TODAY, 3), { status: 'confirmed' })
    expect(bookedAhead(s, [one.id, two.id, three.id], TODAY)).toBe(true)
  })

  it('says when the usual treatment is no longer on the menu', () => {
    const s = studio()
    const ava = addClient(s, 'Ava Williams')
    monthlyRegular(s, ava.id, SATURDAY, 4, { serviceId: 'massage', staffId: 'theo' })
    s.services.find((x) => x.id === 'massage')!.archived = true
    expect(guestUsual(s, ava.id, TODAY)).toMatchObject({
      none: 'treatment-gone',
      treatment: { serviceId: 'massage', name: 'Deep Massage' },
      changes: [],
    })
    expect(guestUsual(s, ava.id, TODAY)).not.toHaveProperty('professional')
    // Removed from the record entirely: named as it was booked.
    const fresh = studio()
    const noor = addClient(fresh, 'Noor Ahmed')
    fresh.services.push({ ...fresh.services[0], id: 'brows', name: 'Brow Shape' })
    monthlyRegular(fresh, noor.id, SATURDAY, 4, {
      serviceId: 'brows',
      bookedServiceName: 'Brow Shape',
    })
    fresh.services = fresh.services.filter((x) => x.id !== 'brows')
    expect(guestUsual(fresh, noor.id, TODAY)).toMatchObject({
      none: 'treatment-gone',
      treatment: { serviceId: 'brows', name: 'Brow Shape' },
    })
  })

  it('leaves out someone who has left or no longer does it, and says so', () => {
    const s = studio()
    const ava = addClient(s, 'Ava Williams')
    monthlyRegular(s, ava.id, SATURDAY, 4, { staffId: 'theo' })
    const theo = s.staff.find((p) => p.id === 'theo')!
    theo.archived = true
    const away = guestUsual(s, ava.id, TODAY)
    expect(away).toMatchObject({
      treatment: { serviceId: 'facial' },
      changes: [{ kind: 'professional-away', staffId: 'theo', name: 'Theo Grant' }],
    })
    expect(away).not.toHaveProperty('professional')
    expect(away).not.toHaveProperty('onlineStop')
    // The client page still names who they usually saw, as before.
    expect(clientInsight(s, ava, TODAY).favouriteProfessional?.staffId).toBe('theo')
    theo.archived = false
    theo.serviceIds = ['massage']
    expect(guestUsual(s, ava.id, TODAY).changes).toEqual([
      { kind: 'professional-not-doing', staffId: 'theo', name: 'Theo Grant' },
    ])
  })

  it('keeps the usual location, and says when the person they see has moved', () => {
    const s = islington(studio(), ['theo'])
    const ava = addClient(s, 'Ava Williams')
    // Four Saturdays with Maya at the main location.
    monthlyRegular(s, ava.id, SATURDAY, 4)
    expect(guestUsual(s, ava.id, TODAY)).toMatchObject({
      professional: { staffId: 'maya' },
      location: { locationId: s.organisation.locationId, name: s.organisation.locationName },
      changes: [],
    })
    // Maya now works at Islington: the usual stays at the main location, with anyone there.
    islington(s, ['maya'])
    s.staff.find((p) => p.id === 'theo')!.hours = undefined
    const moved = guestUsual(s, ava.id, TODAY)
    expect(moved).toMatchObject({
      location: { locationId: s.organisation.locationId },
      changes: [
        {
          kind: 'professional-moved',
          staffId: 'maya',
          name: 'Maya Lind',
          locationId: 'islington',
          location: 'Islington',
        },
      ],
    })
    expect(moved).not.toHaveProperty('professional')
  })

  it('finds where a guest of several locations usually goes, and what changed there', () => {
    const s = islington(studio(), ['theo'])
    const ava = addClient(s, 'Ava Williams')
    for (const date of ['2026-09-05', '2026-09-12', '2026-09-19'])
      addVisit(s, ava.id, date, { staffId: 'theo', locationId: 'islington' })
    addVisit(s, ava.id, '2026-09-26')
    expect(guestUsual(s, ava.id, TODAY)).toMatchObject({
      professional: { staffId: 'theo' },
      location: { locationId: 'islington', name: 'Islington' },
    })
    // Islington no longer offers the facial.
    s.services.find((x) => x.id === 'facial')!.notOfferedAt = ['islington']
    expect(guestUsual(s, ava.id, TODAY).changes).toContainEqual({
      kind: 'location-not-offered',
      locationId: 'islington',
      location: 'Islington',
    })
    s.services.find((x) => x.id === 'facial')!.notOfferedAt = undefined
    // Islington closes; Theo works at the main location again.
    s.operations!.locations![0].archived = true
    s.staff.find((p) => p.id === 'theo')!.hours = undefined
    const closed = guestUsual(s, ava.id, TODAY)
    expect(closed.changes).toEqual([
      { kind: 'location-closed', locationId: 'islington', location: 'Islington' },
    ])
    expect(closed).not.toHaveProperty('location')
    // With one open location, none is named.
    expect(closed).toMatchObject({ professional: { staffId: 'theo' } })
  })

  it('says when the usual cannot be booked online, so only the desk books it', () => {
    const s = studio()
    const ava = addClient(s, 'Ava Williams')
    monthlyRegular(s, ava.id, SATURDAY, 4, { serviceId: 'colour' })
    expect(guestUsual(s, ava.id, TODAY)).not.toHaveProperty('onlineStop')
    s.operations = {
      ...operations(s),
      patchTests: { ...patchTestSettings(s), stopOnline: true },
    }
    expect(guestUsual(s, ava.id, TODAY).onlineStop).toMatch(
      /^Gloss Colour needs a patch test first, so it cannot be booked online\./,
    )
    // Still their usual, with the person they see, for the desk to book.
    expect(guestUsual(s, ava.id, TODAY)).toMatchObject({
      treatment: { serviceId: 'colour' },
      professional: { staffId: 'maya' },
    })
    const other = studio()
    const noor = addClient(other, 'Noor Ahmed')
    monthlyRegular(other, noor.id, SATURDAY, 4)
    other.services.find((x) => x.id === 'facial')!.notOfferedAt = [other.organisation.locationId]
    expect(guestUsual(other, noor.id, TODAY).onlineStop).toBe(
      'Restorative Facial cannot be booked online just now.',
    )
  })
})

describe('who is writing by text', () => {
  it('is known from one record, or from several that share one email, and the latest is used', () => {
    const s = studio()
    const one = addClient(s, 'Amelia Carter', {
      email: 'amelia@example.com',
      phone: '+44 7700 900456',
    })
    expect(textingGuest(s, 'sms', '+447700900456')?.id).toBe(one.id)
    const two = addClient(s, 'Amelia Carter', {
      email: 'Amelia@example.com',
      phone: '+447700900456',
    })
    addVisit(s, one.id, '2026-09-05')
    addVisit(s, two.id, '2026-09-12')
    expect(textingGuest(s, 'sms', '+447700900456')?.id).toBe(two.id)
    expect(textingGuest(s, 'whatsapp', '+447700900456')?.id).toBe(two.id)
    expect(textingRecords(s, two.id).sort()).toEqual([one.id, two.id].sort())
    // A record with the same email but another number is the same guest, not the same phone.
    const three = addClient(s, 'Amelia Carter', {
      email: 'amelia@example.com',
      phone: '+447700900999',
    })
    expect(textingRecords(s, two.id)).not.toContain(three.id)
    // A number shared with someone else is nobody for sure.
    addClient(s, 'Ben Carter', { email: 'ben@example.com', phone: '+447700900456' })
    expect(textingGuest(s, 'sms', '+447700900456')).toBeUndefined()
    expect(textingGuest(s, 'sms', 'not a number')).toBeUndefined()
  })
})

describe('a guest beside one of their visits', () => {
  it('reads earlier visits and what is good to remember from every record with their email', () => {
    const s = studio()
    const desk = addClient(s, 'Rosa Field', {
      email: 'rosa@example.com',
      preferences: 'Likes a quiet room.',
      createdAt: '2026-07-01T09:00:00.000Z',
    })
    monthlyRegular(s, desk.id, '2026-08-08', 2)
    const online = addClient(s, 'Rosa Field', {
      email: 'Rosa@Example.com',
      createdAt: '2026-08-08T09:00:00.000Z',
    })
    monthlyRegular(s, online.id, SATURDAY, 2)
    // Her quiet-time booking opened a third record.
    const latest = addClient(s, 'Rosa Field', {
      email: 'rosa@example.com',
      createdAt: '2026-10-10T05:00:00.000Z',
    })
    const visit = addVisit(s, latest.id, '2026-10-17', { status: 'confirmed', source: 'online' })
    const background = guestBackground(s, visit)
    expect(background.earlier.map((a) => a.date)).toEqual([
      SATURDAY,
      '2026-09-05',
      '2026-08-08',
      '2026-07-11',
    ])
    expect(background.records).toBe(3)
    expect(background.remembered).toBe('Likes a quiet room.')
    expect([...background.ids].sort()).toEqual([desk.id, online.id, latest.id].sort())
    // The visit's own record speaks first when it has something written.
    latest.preferences = 'Allergic to lavender.'
    expect(guestBackground(s, visit).remembered).toBe('Allergic to lavender.')
  })

  it('never reads another guest, and counts only visits before this one', () => {
    const s = studio()
    const amelia = addClient(s, 'Amelia Carter', { email: 'amelia@example.com' })
    const other = addClient(s, 'Amelia Carter', {
      email: 'another.amelia@example.com',
      preferences: 'Not her.',
    })
    addVisit(s, other.id, '2026-09-05')
    const first = addVisit(s, amelia.id, '2026-09-12')
    addVisit(s, amelia.id, '2026-10-24', { status: 'confirmed' })
    expect(guestBackground(s, first)).toMatchObject({ earlier: [], records: 1, remembered: '' })
    // A guest with no email is only their own record.
    const walkIn = addClient(s, 'Walk In', { email: '' })
    const fresh = addClient(s, 'Walk In', { email: '' })
    addVisit(s, walkIn.id, '2026-09-05')
    const visit = addVisit(s, fresh.id, '2026-10-24', { status: 'confirmed' })
    expect(guestBackground(s, visit).earlier).toEqual([])
  })
})
