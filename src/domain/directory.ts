import { businessDate } from './operations'
import { serviceRevenue } from './selectors'
import { addDays } from './format'
import type { Appointment, BusinessState, Client } from './model'

/**
 * The client directory as one query: segment, search, sort and page. It is
 * shaped like the request a server will answer once clients live in Postgres,
 * so the page only ever asks for one page of rows and the counts beside it.
 */
export type DirectorySegment = 'all' | 'due' | 'new' | 'week' | 'consented'
export type DirectorySort = 'recent' | 'name' | 'visits' | 'spend'

export interface DirectoryRow {
  client: Client
  visits: number
  spend: number
  /** Most recent completed visit, or today when they are in the studio or seen today. */
  lastDate?: string
  nextDate?: string
  firstVisitToday: boolean
  isNew: boolean
  due: boolean
  bookedThisWeek: boolean
}

export const DIRECTORY_PAGE_SIZE = 25

function weekBounds(today: string) {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(today, -weekday)
  return [monday, addDays(monday, 6)] as const
}

export function directoryRows(s: BusinessState): DirectoryRow[] {
  const today = businessDate(s)
  const month = today.slice(0, 7)
  const [weekStart, weekEnd] = weekBounds(today)
  const byClient = new Map<string, Appointment[]>()
  for (const a of s.appointments) {
    const list = byClient.get(a.clientId)
    if (list) list.push(a)
    else byClient.set(a.clientId, [a])
  }
  const salesByAppointment = new Map(s.sales.map((sale) => [sale.appointmentId, sale]))
  return s.clients.map((client) => {
    const own = byClient.get(client.id) ?? []
    const kept = own.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
    const completed = own.filter((a) => a.status === 'completed')
    const spend = completed.reduce((sum, a) => {
      const sale = salesByAppointment.get(a.id)
      return sale ? sum + serviceRevenue(sale) : sum
    }, 0)
    const seenToday = kept.some(
      (a) => a.date === today && (a.status === 'arrived' || a.status === 'completed'),
    )
    const lastCompleted = completed
      .filter((a) => a.date <= today)
      .reduce<string | undefined>((max, a) => (!max || a.date > max ? a.date : max), undefined)
    const lastDate = seenToday ? today : lastCompleted
    const nextDate = own
      .filter((a) => a.status === 'confirmed' && a.date >= today)
      .reduce<string | undefined>((min, a) => (!min || a.date < min ? a.date : min), undefined)
    const firstDate = kept.reduce<string | undefined>(
      (min, a) => (!min || a.date < min ? a.date : min),
      undefined,
    )
    const visitedBefore = completed.some((a) => a.date < today)
    return {
      client,
      visits: completed.length,
      spend,
      lastDate,
      nextDate,
      firstVisitToday: !visitedBefore && kept.some((a) => a.date === today),
      isNew: firstDate ? firstDate.slice(0, 7) === month : client.createdAt.slice(0, 7) === month,
      due:
        !!lastCompleted &&
        lastCompleted <= addDays(today, -28) &&
        !nextDate &&
        !own.some((a) => a.status === 'arrived'),
      bookedThisWeek: kept.some(
        (a) => a.date >= weekStart && a.date <= weekEnd && a.status !== 'completed',
      ),
    }
  })
}

const digits = (value: string) => value.replace(/\D/g, '')

export function matchesQuery(client: Client, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (`${client.name} ${client.email}`.toLowerCase().includes(q)) return true
  // A local number typed with its leading 0 (07700 900003) still finds +44 7700 900003.
  const d = digits(q).replace(/^0/, '')
  return d.length >= 3 && digits(client.phone).includes(d)
}

const inSegment: Record<DirectorySegment, (row: DirectoryRow) => boolean> = {
  all: () => true,
  due: (row) => row.due,
  new: (row) => row.isNew,
  week: (row) => row.bookedThisWeek,
  consented: (row) => row.client.marketingConsent,
}

const sorters: Record<DirectorySort, (a: DirectoryRow, b: DirectoryRow) => number> = {
  recent: (a, b) =>
    (b.lastDate ?? '').localeCompare(a.lastDate ?? '') ||
    (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') ||
    a.client.name.localeCompare(b.client.name),
  name: (a, b) => a.client.name.localeCompare(b.client.name),
  visits: (a, b) => b.visits - a.visits || a.client.name.localeCompare(b.client.name),
  spend: (a, b) => b.spend - a.spend || a.client.name.localeCompare(b.client.name),
}

export function queryDirectory(
  rows: DirectoryRow[],
  {
    segment = 'all',
    query = '',
    sort = 'recent',
    page = 1,
    pageSize = DIRECTORY_PAGE_SIZE,
  }: {
    segment?: DirectorySegment
    query?: string
    sort?: DirectorySort
    page?: number
    pageSize?: number
  },
) {
  const searched = rows.filter((row) => matchesQuery(row.client, query))
  const counts = Object.fromEntries(
    (Object.keys(inSegment) as DirectorySegment[]).map((key) => [
      key,
      searched.filter(inSegment[key]).length,
    ]),
  ) as Record<DirectorySegment, number>
  const matching = searched.filter(inSegment[segment]).sort(sorters[sort])
  const pages = Math.max(1, Math.ceil(matching.length / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * pageSize
  return {
    rows: matching.slice(start, start + pageSize),
    total: matching.length,
    counts,
    page: current,
    pages,
    from: matching.length ? start + 1 : 0,
    to: Math.min(start + pageSize, matching.length),
  }
}
