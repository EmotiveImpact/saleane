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
    // Stage 4: a general manager has a guide for their own team and rooms.
    expect(ids(helpArticles('general'))).toEqual(
      expect.arrayContaining(['general-team', 'rota', 'rota-day', 'spaces']),
    )
    for (const id of ['hours', 'team', 'treatments'])
      expect(ids(helpArticles('general'))).not.toContain(id)
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
      'practitioner-clock',
      'practitioner-target',
      'practitioner-diary',
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
    expect(first('find the printer ip address')).toBe('till-printer')
    expect(first('which receipt printer should I buy')).toBe('choose-printer')
    expect(first('does it work with my printer')).toBe('choose-printer')
    expect(ids(helpForScreen('/settings', '?section=till', 'owner')).slice(0, 2)).toEqual([
      'till-printer',
      'choose-printer',
    ])
    expect(ids(searchHelp('which printer to buy', 'reception'))).not.toContain('choose-printer')
    expect(first('email a receipt')).toBe('receipts')
    expect(first('product picture')).toBe('product-photo')
    expect(first('clock in')).toBe('clock')
    expect(first('timesheet forgot to clock out')).toBe('hours-worked')
    expect(first('clock in', 'practitioner')).toBe('practitioner-clock')
    expect(first('stop online booking without a patch test')).toBe('patch-test-online')
    expect(first('block colour bookings online until patch tested')).toBe('patch-test-online')
    expect(first('patch test online', 'reception')).not.toBe('patch-test-online')
    expect(first('change a shift for one day')).toBe('rota-day')
    expect(first('extra day')).toBe('rota-day')
    expect(first('copy last week rota')).toBe('rota-day')
    expect(first('sick leave')).toBe('rota')
    expect(first('my shift', 'practitioner')).toBe('practitioner-day')
    expect(searchHelp('change a shift for one day', 'reception')[0]?.id).not.toBe('rota-day')
    // Stage 4: a general manager finds their own team's guide, and the rota and rooms guides.
    expect(first('my team at my location', 'general')).toBe('general-team')
    expect(first('change a shift for one day', 'general')).toBe('rota-day')
    expect(first('change time off', 'general')).toBe('rota')
    expect(searchHelp('treatment room', 'general').map((a) => a.id)).toContain('spaces')
    expect(searchHelp('my location team', 'manager').map((a) => a.id)).not.toContain('general-team')
    expect(searchHelp('add a room', 'reception').map((a) => a.id)).not.toContain('spaces')
    // Stage 3: commission by treatment or product, steps, targets and chair rent.
    expect(first('tiered commission')).toBe('commission-steps')
    expect(first('commission rate for one treatment')).toBe('commission-rates')
    expect(first('monthly sales target')).toBe('staff-targets')
    expect(first('booth rental percentage')).toBe('chair-rent')
    expect(first('my target', 'practitioner')).toBe('practitioner-target')
    // Stage 4: sign-offs for refunds, prices and the rota.
    expect(first('refund over my limit', 'general')).toBe('refund-sign-off')
    expect(first('goodwill refund approval', 'manager')).toBe('refund-sign-off')
    expect(first('put up the price of a treatment', 'general')).toBe('price-sign-off')
    expect(first('refund limit')).toBe('signoff-rules')
    expect(first('extra days need a sign-off')).toBe('signoff-rules')
    expect(searchHelp('refund limit', 'reception').map((a) => a.id)).not.toContain('signoff-rules')
    expect(searchHelp('commission steps', 'manager').map((a) => a.id)).not.toContain(
      'commission-steps',
    )
    // Stage 4: moving a gift card or someone to another location.
    expect(first('transfer a gift card to another branch')).toBe('gift-card-move')
    expect(first('move a gift card', 'general')).toBe('gift-card-move')
    expect(first('gift voucher')).toBe('gift-cards')
    expect(first('move a staff member to another location')).toBe('staff-move')
    expect(first('transfer an employee to a new branch')).toBe('staff-move')
    expect(first('relocate a therapist', 'manager')).toBe('staff-move')
    expect(
      searchHelp('move someone to another location', 'general').map((a) => a.id),
    ).not.toContain('staff-move')
    expect(searchHelp('move a gift card', 'reception').map((a) => a.id)).not.toContain(
      'gift-card-move',
    )
    expect(first('reschedule an appointment')).toBe('move-visit')
    // Stage 5: a guest asking for their usual, for the people who answer guests.
    expect(first('guest asks for their usual')).toBe('usual')
    expect(first('same as last time', 'reception')).toBe('usual')
    expect(first('book a client their usual', 'general')).toBe('usual')
    expect(ids(searchHelp('my usual', 'practitioner'))).not.toContain('usual')
    expect(ids(searchHelp('my usual', 'regional'))).not.toContain('usual')
    expect(first('client insight')).toBe('at-a-glance')
    // Stage 4: one message to many clients.
    expect(first('send a newsletter to all clients')).toBe('news')
    expect(first('group message')).toBe('news')
    expect(first('bulk email')).toBe('news')
    expect(first('which clients are left out')).toBe('news-who')
    expect(first('approve a message to clients')).toBe('news-approve')
    expect(first('newsletter', 'general')).toBe('news')
    expect(ids(searchHelp('newsletter', 'reception'))).not.toContain('news')
    expect(ids(searchHelp('newsletter', 'practitioner'))).not.toContain('news')
    expect(ids(helpForScreen('/inbox/news', '', 'owner')).slice(0, 3)).toEqual([
      'news',
      'news-who',
      'news-approve',
    ])
    // Stage 5: access keys for other software, what it can send in, and other tills' sales.
    expect(first('api key')).toBe('access-keys')
    expect(first('let my booking tool add visits')).toBe('access-keys')
    expect(first('email news consent from other software')).toBe('send-in')
    expect(first('sync clients without duplicates')).toBe('send-in')
    expect(first('epos sales from our shop till')).toBe('other-tills')
    expect(first('sales from another till', 'general')).toBe('other-tills')
    expect(ids(searchHelp('api key', 'manager'))).not.toContain('access-keys')
    expect(ids(searchHelp('other till sales', 'reception'))).not.toContain('other-tills')
    expect(ids(helpForScreen('/settings', '?section=connections', 'owner'))).toEqual([
      'access-keys',
      'send-in',
    ])
    // Stage 5: a lower price for a quiet time.
    expect(first('discount a quiet time')).toBe('quiet-offers')
    expect(first('cheaper off peak price')).toBe('quiet-offers')
    expect(first('lower price for a gap', 'reception')).toBe('quiet-offers')
    expect(ids(searchHelp('discount quiet time', 'practitioner'))).not.toContain('quiet-offers')
    // Stage 6: records at the end of their keeping period.
    expect(first('delete old client records')).toBe('retention-decisions')
    expect(first('keeping period')).toBe('retention-decisions')
    expect(first('keep records longer', 'manager')).toBe('retention-decisions')
    expect(ids(searchHelp('delete old records', 'reception'))).not.toContain('retention-decisions')
    expect(ids(searchHelp('keeping period', 'practitioner'))).not.toContain('retention-decisions')
    expect(ids(helpForScreen('/settings', '?section=privacy', 'owner'))).toContain(
      'retention-decisions',
    )
    // Stage 6: a guest booked under several records reads as one conversation.
    expect(first('same guest two records in the inbox')).toBe('inbox-one-guest')
    expect(first('client booked online twice duplicate conversation')).toBe('inbox-one-guest')
    expect(first('two records same email', 'reception')).toBe('inbox-one-guest')
    expect(ids(searchHelp('two records same email', 'practitioner'))).not.toContain(
      'inbox-one-guest',
    )
    // Stage 6: two-step sign-in for everyone with an account, and the owner's switch.
    expect(first('two factor', 'practitioner')).toBe('two-step')
    expect(first('authenticator app', 'regional')).toBe('two-step')
    expect(first('recovery codes', 'reception')).toBe('two-step')
    expect(first('require two factor for everyone')).toBe('two-step-everyone')
    expect(first('make the whole team use 2fa')).toBe('two-step-everyone')
    expect(ids(searchHelp('require two factor for everyone', 'manager'))).not.toContain(
      'two-step-everyone',
    )
    expect(ids(helpForScreen('/account', '', 'practitioner'))).toContain('two-step')
    // Stage 6: the small moments, and when each one appears.
    expect(first('fully booked beautifully done')).toBe('small-moments')
    expect(first('what does all in hand mean')).toBe('small-moments')
    expect(first('closing ledger end of day', 'general')).toBe('small-moments')
    expect(ids(searchHelp('settled pause', 'practitioner'))).not.toContain('small-moments')
    // Stage 5: booking on Google, with its new way to change the time.
    expect(first('book on google maps')).toBe('google-booking')
    expect(first('reserve with google')).toBe('google-booking')
    expect(ids(searchHelp('google maps', 'manager'))).not.toContain('google-booking')
    // Stage 5: booking through ChatGPT or Claude, for the owner only.
    expect(first('book through chatgpt')).toBe('ai-booking')
    expect(first('claude booking')).toBe('ai-booking')
    expect(first('openai connector')).toBe('ai-booking')
    expect(ids(searchHelp('chatgpt', 'manager'))).not.toContain('ai-booking')
    // Stage 6: the wording guide, for anyone at the desk who writes to guests.
    expect(first('how should I word a message')).toBe('speaks')
    expect(first('tone of voice')).toBe('speaks')
    expect(first('writing style guide', 'reception')).toBe('speaks')
    expect(ids(searchHelp('tone of voice', 'practitioner'))).not.toContain('speaks')
    expect(ids(helpForScreen('/design-language', '', 'owner'))).toContain('speaks')
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
