import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HELP_GROUPS,
  helpArticles,
  helpDestination,
  helpForScreen,
  helpWords,
  searchHelp,
} from './help'
import { HELP_ARTICLES } from './helpArticles'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
/**
 * Every address the app answers: its routes, with `:param` parts as a prefix, and the pages it
 * opens by their address before any route, such as the account page and the day sheet.
 */
const app = source('../App.tsx') + source('../components/DaySheetGate.tsx')
const routes = [
  ...[...app.matchAll(/<Route\s+path="([^"*]+)"/g)].map((m) => m[1].replace(/\/:[^/]+.*$/, '')),
  ...[...app.matchAll(/pathname === '([^']+)'/g)].map((m) => m[1]),
]
/** Every Settings section, from the list Settings draws. */
const sections = [...source('../pages/Manage.tsx').matchAll(/\{ id: '([a-z-]+)', label:/g)].map(
  (m) => m[1],
)
const ids = (list: readonly { id: string }[]) => list.map((a) => a.id)

describe('help inside the app', () => {
  it('sends people only to screens and Settings sections that exist', () => {
    expect(sections).toContain('billing')
    expect(routes).toContain('/business/money')
    for (const article of HELP_ARTICLES)
      for (const place of [...article.screens, ...(article.to ? [article.to] : [])]) {
        const [path, query] = place.split('?')
        expect(routes, `${article.id}: ${place}`).toContain(path)
        if (query)
          expect(sections, `${article.id}: ${place}`).toContain(query.replace('section=', ''))
      }
  })

  it('keeps every guide whole, in plain British English', () => {
    expect(new Set(ids(HELP_ARTICLES)).size).toBe(HELP_ARTICLES.length)
    for (const article of HELP_ARTICLES) {
      expect(HELP_GROUPS).toContain(article.group)
      expect(article.steps.length).toBeGreaterThan(0)
      const text = [article.title, article.summary, ...article.steps, article.note ?? ''].join(' ')
      expect(text, article.id).not.toMatch(/[—–]|\bcolor\b|\bcenter\b|\bappointment|\bcustomer/i)
      for (const line of [
        article.summary,
        ...article.steps,
        ...(article.note ? [article.note] : []),
      ])
        expect(line, article.id).toMatch(/[.?!:)”"]$/)
    }
  })

  it('shows each person only the guides for what they can do', () => {
    const owner = ids(helpArticles('owner'))
    const reception = ids(helpArticles('reception'))
    const practitioner = ids(helpArticles('practitioner'))
    expect(owner).toEqual(expect.arrayContaining(['billing', 'invite', 'refund', 'tax']))
    expect(reception).toEqual(expect.arrayContaining(['book-visit', 'checkout', 'till']))
    expect(reception).not.toEqual(expect.arrayContaining(['refund']))
    expect(reception).not.toContain('billing')
    expect(practitioner).toEqual(
      expect.arrayContaining(['practitioner-day', 'practitioner-patch', 'day-sheet']),
    )
    expect(practitioner).not.toContain('checkout')
    expect(ids(helpArticles('regional'))).toContain('area')
    // Someone with no studio open sees only the guides meant for everyone.
    expect(ids(helpArticles(null))).toEqual(ids(HELP_ARTICLES.filter((article) => !article.roles)))
  })

  it('puts the guides for the screen first, a Settings section before the rest', () => {
    expect(ids(helpForScreen('/settings', '?section=billing', 'owner'))).toEqual([
      'billing',
      'unpaid',
    ])
    expect(helpForScreen('/settings', '?section=billing', 'manager')).toEqual([])
    expect(ids(helpForScreen('/business/money', '', 'reception'))).toEqual([
      'till',
      'receipts',
      'cash-drawer',
    ])
    expect(ids(helpForScreen('/clients/abc', '', 'owner'))).toContain('patch-tests')
    expect(ids(helpForScreen('/practice/org-1', '', 'practitioner'))).toEqual([
      'practitioner-day',
      'practitioner-patch',
      'day-sheet',
    ])
    expect(helpForScreen('/today', '', 'owner')[0].id).toBe('get-ready')
    expect(ids(helpForScreen('/area/org-1', '', 'regional'))).toEqual([
      'area',
      'branch-visits',
      'requests',
    ])
  })

  it('finds guides in the words people use, best first', () => {
    const first = (query: string, role: Parameters<typeof searchHelp>[1] = 'owner') =>
      searchHelp(query, role)[0]?.id
    expect(first('How do I refund a payment?')).toBe('refund')
    expect(first('reschedule an appointment')).toBe('move-visit')
    expect(first('no show')).toBe('cancel-visit')
    expect(first('invite new staff')).toBe('invite')
    expect(first('gift voucher')).toBe('gift-cards')
    expect(first('forgot password')).toBe('forgotten-password')
    expect(first('two factor')).toBe('two-step')
    expect(first('my subscription')).toBe('billing')
    expect(first('GDPR')).toBe('client-privacy')
    expect(first('xero')).toBe('accounts')
    expect(first('take a membership from their card every month')).toBe('membership-card')
    expect(first('client replied STOP')).toBe('text-stop')
    expect(first('unsubscribe from texts')).toBe('text-stop')
    expect(first('client insight')).toBe('at-a-glance')
    expect(first('barcode scanner')).toBe('barcodes')
    expect(first('no sale')).toBe('cash-drawer')
    expect(first('set up a receipt printer')).toBe('till-printer')
    expect(first('email a receipt')).toBe('receipts')
    expect(first('product picture')).toBe('product-photo')
    expect(searchHelp('the', 'owner')).toEqual([])
    expect(searchHelp('rocket launch', 'owner')).toEqual([])
    expect(helpWords("Customer's bookings")).toEqual(['client', 'visit'])
  })
  it('offers Go there only to people who open the studio screens', () => {
    const visits = HELP_ARTICLES.find((a) => a.id === 'branch-visits')!
    expect(helpDestination(visits, 'owner')).toBe('/business/visits')
    expect(helpDestination(visits, 'general')).toBe('/business/visits')
    // A regional manager's area page and a practitioner's day are all they open.
    expect(helpDestination(visits, 'regional')).toBeUndefined()
    expect(helpDestination(visits, 'practitioner')).toBeUndefined()
    // With no studio open, there is no studio screen to go to.
    expect(helpDestination(visits, null)).toBeUndefined()
  })
})
