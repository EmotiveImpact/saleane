import type { BusinessState, Service } from './model'

/**
 * V3 local and seasonal awareness: what is happening around the studio that could make a special
 * worth running. Each source sits behind the same small adapter so a live feed can replace the
 * test one later without touching the suggestions. Every source here is in test mode: the
 * calendar and bank holidays are bundled copies, and the school dates, weather and events are
 * sample data. Nothing is fetched and nothing costs money.
 */

export type Category = Service['category']
export type SignalKind = 'occasion' | 'bank-holiday' | 'school-holiday' | 'weather' | 'event'

export type LocalSignal = {
  id: string
  kind: SignalKind
  title: string
  /** The days a special for this would run: usually the run-up, when guests book for it. */
  startDate: string
  endDate: string
  /** How many days before `startDate` it is worth suggesting, so there is time to tell clients. */
  leadDays: number
  /** The kinds of treatment it suits. */
  categories: Category[]
  /** Why it matters to a studio, in one sentence. */
  why: string
  /** A starting idea for the special, which the manager can change. */
  idea: string
  /** Where it came from, shown beside the suggestion. */
  source: string
  /** Shown when a date is not certain, such as festivals set by the moon. */
  caution?: string
}

export type LocalSource = {
  id: string
  label: string
  /** False while the source is sample or bundled data; a live adapter sets this when connected. */
  live: boolean
  signals(state: BusinessState, from: string, to: string): LocalSignal[]
}

const within = (from: string, to: string) => (s: LocalSignal) =>
  s.endDate >= from && s.startDate <= to

type Occasion = Omit<LocalSignal, 'kind' | 'source'> & { region?: 'UK' | 'US' }

const MOON =
  'The exact day depends on the moon, so check the date with your community before promising it.'

/** The time of year: festivals, gifting days and seasons, for the next year and a bit. */
const OCCASIONS: Occasion[] = [
  {
    id: 'diwali-2026',
    title: 'Diwali',
    startDate: '2026-10-26',
    endDate: '2026-11-07',
    leadDays: 28,
    categories: ['Hair', 'Skin'],
    why: 'Diwali is on Sunday 8 November, and many guests want hair and skin ready for family celebrations.',
    idea: 'A festival glow: a facial or blow-dry booked in the fortnight before Diwali.',
  },
  {
    id: 'thanksgiving-2026',
    region: 'US',
    title: 'Thanksgiving',
    startDate: '2026-11-19',
    endDate: '2026-11-25',
    leadDays: 28,
    categories: ['Hair'],
    why: 'Thanksgiving is on Thursday 26 November, and the week before is a busy time for blowouts.',
    idea: 'A pre-Thanksgiving blowout week, with evening times held for working guests.',
  },
  {
    id: 'black-friday-2026',
    title: 'Black Friday weekend',
    startDate: '2026-11-27',
    endDate: '2026-11-30',
    leadDays: 35,
    categories: ['Skin', 'Body', 'Hair'],
    why: 'Black Friday is on 27 November, when many guests look for a treat or an early Christmas present.',
    idea: 'A weekend-only offer for anyone who books a visit for December.',
  },
  {
    id: 'party-season-2026',
    title: 'Christmas party season',
    startDate: '2026-11-27',
    endDate: '2026-12-24',
    leadDays: 56,
    categories: ['Hair', 'Skin'],
    why: 'Christmas parties run from late November, and guests book party hair and skin weeks ahead.',
    idea: 'Party-ready: a blow-dry or glow facial, with Friday and Saturday times released early.',
  },
  {
    id: 'new-year-2026',
    title: "New Year's Eve",
    startDate: '2026-12-28',
    endDate: '2026-12-31',
    leadDays: 35,
    categories: ['Hair'],
    why: "New Year's Eve falls on a Thursday, so the days before it are busy for hair.",
    idea: 'New Year finishes: blow-dries and styling in the last days of December.',
  },
  {
    id: 'january-2027',
    title: 'A January reset',
    startDate: '2027-01-04',
    endDate: '2027-01-31',
    leadDays: 35,
    categories: ['Body', 'Skin'],
    why: 'January is usually quieter after the holidays, and guests think about looking after themselves.',
    idea: 'A reset offer on massage and facials booked in January.',
  },
  {
    id: 'lunar-new-year-2027',
    title: 'Lunar New Year',
    startDate: '2027-01-30',
    endDate: '2027-02-05',
    leadDays: 28,
    categories: ['Hair', 'Skin'],
    why: 'Lunar New Year is on Saturday 6 February, and a fresh cut before it is a tradition for many.',
    idea: 'A fresh-start cut or facial in the week before Lunar New Year.',
  },
  {
    id: 'valentines-2027',
    title: "Valentine's Day",
    startDate: '2027-02-08',
    endDate: '2027-02-14',
    leadDays: 35,
    categories: ['Skin', 'Body'],
    why: "Valentine's Day is on a Sunday, so the weekend before it is when guests treat themselves or each other.",
    idea: 'A treat for two, or a glow facial before the weekend.',
  },
  {
    id: 'mothers-day-uk-2027',
    region: 'UK',
    title: "Mother's Day",
    startDate: '2027-02-22',
    endDate: '2027-03-07',
    leadDays: 42,
    categories: ['Skin', 'Body'],
    why: "Mother's Day in the UK is Sunday 7 March, and treatments are a popular present.",
    idea: 'A visit to give as a present, or time for mother and daughter together.',
  },
  {
    id: 'eid-al-fitr-2027',
    title: 'Eid al-Fitr',
    startDate: '2027-03-01',
    endDate: '2027-03-09',
    leadDays: 35,
    categories: ['Hair', 'Skin'],
    why: 'Eid al-Fitr is expected around 9 March, and many guests want to look their best for it.',
    idea: 'Eid-ready hair and skin, with late-evening times after the fast in the last week of Ramadan.',
    caution: MOON,
  },
  {
    id: 'prom-us-2027',
    region: 'US',
    title: 'Prom season',
    startDate: '2027-04-17',
    endDate: '2027-05-22',
    leadDays: 49,
    categories: ['Hair', 'Skin'],
    why: 'Most proms are in late April and May, and students book hair and skin together.',
    idea: 'A prom-ready package, with a trial and the day itself, for students and their friends.',
  },
  {
    id: 'mothers-day-us-2027',
    region: 'US',
    title: "Mother's Day",
    startDate: '2027-04-26',
    endDate: '2027-05-09',
    leadDays: 42,
    categories: ['Skin', 'Body'],
    why: "Mother's Day in the US is Sunday 9 May, and treatments are a popular present.",
    idea: 'A visit to give as a present, or time for mother and daughter together.',
  },
  {
    id: 'wedding-season-2027',
    title: 'Wedding season',
    startDate: '2027-05-01',
    endDate: '2027-06-30',
    leadDays: 56,
    categories: ['Hair', 'Skin'],
    why: 'Weddings peak from May, and brides and guests book trials weeks before the day.',
    idea: 'Wedding-ready: a hair trial or a course of facials before the day, for the couple and guests.',
  },
  {
    id: 'eid-al-adha-2027',
    title: 'Eid al-Adha',
    startDate: '2027-05-09',
    endDate: '2027-05-16',
    leadDays: 35,
    categories: ['Hair', 'Skin'],
    why: 'Eid al-Adha is expected around 16 May, a time for family gatherings and celebrations.',
    idea: 'Eid-ready hair and skin in the week before.',
    caution: MOON,
  },
  {
    id: 'prom-uk-2027',
    region: 'UK',
    title: 'Prom season',
    startDate: '2027-06-21',
    endDate: '2027-07-10',
    leadDays: 49,
    categories: ['Hair', 'Skin'],
    why: 'School proms run from late June, and students book hair and skin together.',
    idea: 'A prom-ready package, with a trial and the day itself, for students and their friends.',
  },
  {
    id: 'summer-2027',
    title: 'Holiday-ready summer',
    startDate: '2027-07-01',
    endDate: '2027-07-31',
    leadDays: 42,
    categories: ['Body', 'Skin'],
    why: 'July is when guests get ready to go away, and look for treatments before a holiday.',
    idea: 'Holiday-ready: body and skin treatments booked before guests travel.',
  },
]

/** The seasonal calendar. Built in; no service is needed. */
export const seasonCalendar: LocalSource = {
  id: 'season-calendar',
  label: 'Seasonal calendar (built in)',
  live: false,
  signals(state, from, to) {
    return OCCASIONS.filter((o) => !o.region || o.region === state.organisation.region)
      .map((o): LocalSignal => {
        const signal = { ...o, kind: 'occasion' as const, source: 'Seasonal calendar (built in)' }
        delete signal.region
        return signal
      })
      .filter(within(from, to))
  },
}

/** A bank holiday in the GOV.UK list format (https://www.gov.uk/bank-holidays.json). */
export type GovUkBankHolidays = Record<
  string,
  { division: string; events: { title: string; date: string }[] }
>

/** Reads the GOV.UK list, so a live adapter can use the same parsing as the bundled copy. */
export function parseGovUkBankHolidays(json: unknown, division = 'england-and-wales') {
  const list = (json as GovUkBankHolidays | undefined)?.[division]?.events
  if (!Array.isArray(list)) throw new Error('This is not the GOV.UK bank holiday list.')
  return list
    .filter((e) => typeof e.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .map((e) => ({ title: e.title, date: e.date }))
}

/** A bundled copy of the GOV.UK England and Wales list for late 2026 and 2027. */
const GOV_UK_COPY: GovUkBankHolidays = {
  'england-and-wales': {
    division: 'england-and-wales',
    events: [
      { title: 'Christmas Day', date: '2026-12-25' },
      { title: 'Boxing Day', date: '2026-12-28' },
      { title: 'New Year’s Day', date: '2027-01-01' },
      { title: 'Good Friday', date: '2027-03-26' },
      { title: 'Easter Monday', date: '2027-03-29' },
      { title: 'Early May bank holiday', date: '2027-05-03' },
      { title: 'Spring bank holiday', date: '2027-05-31' },
      { title: 'Summer bank holiday', date: '2027-08-30' },
      { title: 'Christmas Day', date: '2027-12-27' },
      { title: 'Boxing Day', date: '2027-12-28' },
    ],
  },
}

/** US federal holidays that fall on a long weekend, from the published OPM list. */
const US_LONG_WEEKENDS = [
  { title: 'Martin Luther King Jr. Day', date: '2027-01-18' },
  { title: "Presidents' Day", date: '2027-02-15' },
  { title: 'Memorial Day', date: '2027-05-31' },
  { title: 'Independence Day (observed)', date: '2027-07-05' },
  { title: 'Labor Day', date: '2027-09-06' },
]

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Long weekends around a Monday or Friday bank holiday. Christmas is left to the calendar. */
export const bankHolidays: LocalSource = {
  id: 'bank-holidays',
  label: 'GOV.UK bank holidays (bundled copy)',
  live: false,
  signals(state, from, to) {
    const us = state.organisation.region === 'US'
    const days = us ? US_LONG_WEEKENDS : parseGovUkBankHolidays(GOV_UK_COPY)
    return days
      .filter((d) => !/christmas|boxing|new year/i.test(d.title))
      .filter((d) => weekday(d.date) === 1 || weekday(d.date) === 5)
      .map((d) => {
        const start = weekday(d.date) === 1 ? shift(d.date, -3) : d.date
        return {
          id: `bank-${d.date}`,
          kind: 'bank-holiday' as const,
          title: `${d.title} weekend`,
          startDate: start,
          endDate: shift(start, 3),
          leadDays: 28,
          categories: ['Body', 'Skin', 'Hair'] as Category[],
          why: `${d.title} makes a long weekend, when guests have time for a longer treatment.`,
          idea: 'A long-weekend treat, with longer treatments offered on the extra day off.',
          source: us ? 'US federal holidays (bundled copy)' : 'GOV.UK bank holidays (bundled copy)',
        }
      })
      .filter(within(from, to))
  },
}

/**
 * School holidays. Term dates differ by council and school, so these are typical England dates
 * marked as sample data; a studio will set its own local dates when the live adapter arrives.
 */
const SCHOOL_HOLIDAYS = [
  {
    id: 'half-term-oct-2026',
    title: 'October half-term',
    startDate: '2026-10-26',
    endDate: '2026-10-30',
  },
  {
    id: 'half-term-feb-2027',
    title: 'February half-term',
    startDate: '2027-02-15',
    endDate: '2027-02-19',
  },
  {
    id: 'easter-hols-2027',
    title: 'Easter holidays',
    startDate: '2027-03-29',
    endDate: '2027-04-09',
  },
  {
    id: 'half-term-may-2027',
    title: 'May half-term',
    startDate: '2027-05-31',
    endDate: '2027-06-04',
  },
]

export const schoolHolidays: LocalSource = {
  id: 'school-holidays',
  label: 'School holidays (sample dates)',
  live: false,
  signals(state, from, to) {
    if (state.organisation.region !== 'UK') return []
    return SCHOOL_HOLIDAYS.map((h) => ({
      ...h,
      kind: 'school-holiday' as const,
      leadDays: 21,
      categories: ['Hair'] as Category[],
      why: `${h.title} frees students and families in the daytime, when weekday mornings are often quieter.`,
      idea: 'A daytime offer for students and families during the holiday week.',
      source: 'School holidays (sample dates)',
      caution: 'Sample dates: each council sets its own, so check yours.',
    })).filter(within(from, to))
  },
}

/** The weather for the next week. Sample data in test mode: a cold, wet spell from day three. */
export const weather: LocalSource = {
  id: 'weather',
  label: 'Weather forecast (sample data)',
  live: false,
  signals(_state, from, to) {
    const startDate = shift(from, 2)
    const endDate = shift(from, 4)
    return [
      {
        id: `weather-${startDate}`,
        kind: 'weather' as const,
        title: 'A cold, wet spell',
        startDate,
        endDate,
        leadDays: 7,
        categories: ['Body'] as Category[],
        why: 'Three cold, wet days are forecast. Guests stay in, but a warming treatment appeals.',
        idea: 'A warm-up massage for the wet days, offered to guests who usually book massage.',
        source: 'Weather forecast (sample data)',
      },
    ].filter(within(from, to))
  },
}

/** Local events. Sample data in test mode; a paid events feed comes later, with a spending cap. */
export const localEvents: LocalSource = {
  id: 'local-events',
  label: 'Local events (sample data)',
  live: false,
  signals(_state, from, to) {
    const race = shift(from, 12)
    return [
      {
        id: `event-run-${race}`,
        kind: 'event' as const,
        title: 'Riverside 10K (sample event)',
        startDate: race,
        endDate: shift(race, 3),
        leadDays: 14,
        categories: ['Body'] as Category[],
        why: 'A sample 10K race nearby brings runners who want recovery treatments in the days after.',
        idea: 'A recovery massage for runners, in the three days after the race.',
        source: 'Local events (sample data)',
      },
    ].filter(within(from, to))
  },
}

/** Every source the studio uses. A live adapter replaces a test one here, never inside a rule. */
export const LOCAL_SOURCES: LocalSource[] = [
  seasonCalendar,
  bankHolidays,
  schoolHolidays,
  weather,
  localEvents,
]

export function localSignals(
  state: BusinessState,
  from: string,
  to: string,
  sources: LocalSource[] = LOCAL_SOURCES,
) {
  return sources
    .flatMap((source) => source.signals(state, from, to))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}
