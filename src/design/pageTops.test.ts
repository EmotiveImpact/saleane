import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  audiences,
  errors,
  refusals,
  regionalForms,
  truthWords,
  voiceRules,
  wordChoices,
} from './voice'

// Stage 6: one pattern for the top of every page (docs/DESIGN_LANGUAGE.md, "Page tops").
const pages = join(process.cwd(), 'src/pages')
const source = (name: string) => readFileSync(join(pages, `${name}.tsx`), 'utf8')

/** Staff pages: each opens with PageHeader, eyebrow first. */
const shared = [
  'Accounts',
  'AreaHome',
  'BranchVisits',
  'Business',
  'Calendar',
  'ClientAreas',
  'Clients',
  'Compare',
  'DaySheet',
  'DesignLanguage',
  'Feedback',
  'GiftCards',
  'Inbox',
  'Manage',
  'Marketing',
  'Money',
  'News',
  'Pay',
  'PractitionerDay',
  'Requests',
  'Rota',
  'Stock',
  'Waitlist',
]
/** Pages with a frame of their own: a greeting panel, a record, guest and account pages. */
const ownFrame = [
  'Account',
  'AccountLink',
  'BrandedBooking',
  'ClientRelationship',
  'LockedStudio',
  'ManageVisit',
  'NewsStop',
  'Pricing',
  'ProtectAccount',
  'ServerBooking',
  'StudioSetup',
  'TeamWelcome',
  'TestBillingCard',
  'TestPayment',
  'Today',
]
/** Places people arrive: the only staff pages whose top carries the photo band. */
const arrivals = [
  'AreaHome',
  'Clients',
  'DesignLanguage',
  'Feedback',
  'PractitionerDay',
  'Waitlist',
]

describe('page tops', () => {
  it('has decided the top of every page', () => {
    const files = readdirSync(pages)
      .filter((name) => /^[A-Z]\w*\.tsx$/.test(name) && !name.includes('.test.'))
      .map((name) => name.replace('.tsx', ''))
      .sort()
    expect(files).toEqual([...shared, ...ownFrame].sort())
  })

  it('opens every staff page with the shared header and its eyebrow', () => {
    for (const page of shared) {
      const code = source(page)
      const headers = [...code.matchAll(/<PageHeader\b([\s\S]*?)(?:actions=|\/>)/g)]
      expect(headers.length, page).toBeGreaterThan(0)
      for (const [, props] of headers) expect(props, page).toMatch(/\beyebrow=/)
    }
  })

  it('keeps the photo band to places people arrive, and only through the header', () => {
    for (const page of shared) {
      const code = source(page)
      expect(code, page).not.toMatch(/<PhotoStrip\b/)
      const banded = /<PageHeader\b[^>]*?\bphoto=\{\{/.test(code.replace(/\n\s*/g, ' '))
      expect(banded, page).toBe(arrivals.includes(page))
    }
  })
})

describe('how SALEANE speaks, on the design language page', () => {
  const lines = [
    ...voiceRules,
    ...truthWords.flat(),
    ...wordChoices.flat(),
    ...refusals,
    ...errors,
    ...audiences.flat(),
    ...regionalForms.flat(),
  ]
  it('follows its own rules', () => {
    for (const line of lines) {
      expect(line).not.toMatch(/[—–!]/)
      expect(line).not.toMatch(/\bcolor\b|\bcenter\b/i)
    }
    // The words to avoid appear only where a rule or the avoid column names them.
    const used = [...truthWords.flat(), ...refusals, ...errors, ...audiences.flat()]
    for (const line of used) expect(line).not.toMatch(/\bappointment|\bcustomer|\bsandbox/i)
  })
  it('keeps every example in the app', () => {
    const app = [
      ...readdirSync(join(process.cwd(), 'src/pages')).map((f) => join('src/pages', f)),
      ...readdirSync(join(process.cwd(), 'src/components')).map((f) => join('src/components', f)),
      ...readdirSync(join(process.cwd(), 'src/domain')).map((f) => join('src/domain', f)),
      ...readdirSync(join(process.cwd(), 'server')).map((f) => join('server', f)),
      ...readdirSync(join(process.cwd(), 'server/routes')).map((f) => join('server/routes', f)),
    ]
      .filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))
      .map((f) => readFileSync(join(process.cwd(), f), 'utf8'))
      .join('\n')
      .replace(/\s+/g, ' ')
    const examples = [
      ...truthWords.map(([, , example]) => example),
      ...wordChoices.map(([, , example]) => example),
      ...refusals,
      ...errors,
      ...audiences.flatMap(([, team, guest]) => [team, guest]),
    ]
    for (const example of examples) expect(app.includes(example), example).toBe(true)
  })
})
