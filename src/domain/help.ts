import type { Role } from './operations'
import { HELP_ARTICLES } from './helpArticles'

/**
 * NEXT-06: help inside the app. Short guides written in the app's own words, found by the screen
 * a person is on or by searching, and a way to write to the SALEANE team. The guides live in
 * `helpArticles.ts`; a test checks every screen and Settings section they send people to exists.
 */
export type HelpGroup =
  | 'Getting started'
  | 'The day'
  | 'Clients'
  | 'Money'
  | 'Team'
  | 'Locations'
  | 'Messages and AI'
  | 'Settings and data'
export const HELP_GROUPS: readonly HelpGroup[] = [
  'Getting started',
  'The day',
  'Clients',
  'Money',
  'Team',
  'Locations',
  'Messages and AI',
  'Settings and data',
]
export type HelpArticle = {
  id: string
  title: string
  group: HelpGroup
  /** One sentence: what this is and why it matters. */
  summary: string
  /** What to do, in order, using the labels on screen. */
  steps: readonly string[]
  /** Anything that is not live yet, said plainly. */
  note?: string
  /** Where "Go there" opens, such as /settings?section=staff. */
  to?: string
  /** The screens it is about: a path, or a path with its Settings section. */
  screens: readonly string[]
  /** Who it is for; everyone who opens Help when left out. */
  roles?: readonly Role[]
  /** Other words people search with. */
  words?: string
}

/** Words people use for the same thing, folded into the app's own word before searching. */
const SAME: Record<string, string> = {
  appointment: 'visit',
  appointments: 'visit',
  booking: 'visit',
  bookings: 'visit',
  customer: 'client',
  customers: 'client',
  guest: 'client',
  guests: 'client',
  staff: 'team',
  employee: 'team',
  employees: 'team',
  stylist: 'professional',
  therapist: 'professional',
  service: 'treatment',
  services: 'treatment',
  treatments: 'treatment',
  reschedule: 'move',
  rebook: 'move',
  delete: 'cancel',
  noshow: 'missed',
  refunds: 'refund',
  login: 'sign',
  log: 'sign',
  signin: 'sign',
  password: 'password',
  payments: 'payment',
  paid: 'payment',
  card: 'payment',
  cards: 'payment',
  invoice: 'bill',
  invoices: 'bill',
  subscription: 'plan',
  billing: 'plan',
  price: 'plan',
  sms: 'text',
  texts: 'text',
  reminders: 'reminder',
  emails: 'email',
  ai: 'saleane',
  assistant: 'saleane',
  chatbot: 'receptionist',
  holiday: 'time',
  holidays: 'time',
  rota: 'rota',
  shifts: 'rota',
  shift: 'rota',
  wages: 'pay',
  commission: 'pay',
  products: 'stock',
  product: 'stock',
  inventory: 'stock',
  gdpr: 'privacy',
  export: 'download',
  exports: 'download',
}
const STOP = new Set(
  'a an and are can do does for from get how i in is it me my of on or the to we what where when who why with you your'.split(
    ' ',
  ),
)

/** The words of a phrase, lower case, with common other words folded into the app's own. */
export function helpWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => SAME[w] ?? w.replace(/(?<=[a-z]{3})s$/, ''))
}

const forRole = (article: HelpArticle, role: Role | null) =>
  !article.roles || (role !== null && article.roles.includes(role))

/** Every guide this person can use, in the order they are written. */
export function helpArticles(role: Role | null, articles = HELP_ARTICLES) {
  return articles.filter((article) => forRole(article, role))
}

/**
 * The guides about the screen a person is on, most specific first: a Settings section's own
 * guides come before the rest of Settings.
 */
export function helpForScreen(
  path: string,
  search: string,
  role: Role | null,
  articles = HELP_ARTICLES,
) {
  const section = new URLSearchParams(search).get('section')
  const here = section ? `${path}?section=${section}` : null
  const score = (article: HelpArticle) =>
    Math.max(
      0,
      ...article.screens.map((screen) =>
        here && screen === here
          ? 3
          : screen === path
            ? 2
            : !screen.includes('?') && path.startsWith(`${screen}/`)
              ? 1
              : 0,
      ),
    )
  return helpArticles(role, articles)
    .map((article) => ({ article, score: score(article) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ article }) => article)
}

/** Guides that match what a person typed, best first; nothing when nothing matches. */
/**
 * Where "Go there" leads for someone in this role. Practitioners and regional managers have their
 * own page instead of the studio's screens, and someone with no studio open has none, so for them
 * the guide's steps say where to go.
 */
export function helpDestination(article: HelpArticle, role: Role | null) {
  if (!article.to || !role || role === 'practitioner' || role === 'regional') return undefined
  return article.to
}

export function searchHelp(query: string, role: Role | null, articles = HELP_ARTICLES) {
  const asked = [...new Set(helpWords(query))]
  if (!asked.length) return []
  return helpArticles(role, articles)
    .map((article) => {
      const title = helpWords(article.title)
      const extra = helpWords(`${article.words ?? ''} ${article.summary}`)
      const body = helpWords(article.steps.join(' '))
      let score = 0,
        found = 0
      for (const word of asked) {
        const hit = (list: string[]) => list.some((w) => w === word || w.startsWith(word))
        const points = hit(title) ? 5 : hit(extra) ? 3 : hit(body) ? 1 : 0
        if (points) found++
        score += points
      }
      // Every word found counts for more than one word found many times.
      return { article, score: score + (found === asked.length ? 4 : 0), found }
    })
    .filter(({ found }) => found > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ article }) => article)
}

/** What someone writing to the SALEANE team can say it is about. */
export const SUPPORT_TOPICS = ['using', 'billing', 'problem', 'idea', 'other'] as const
export type SupportTopic = (typeof SUPPORT_TOPICS)[number]
export const supportTopicWords: Record<SupportTopic, string> = {
  using: 'How to do something',
  billing: 'My SALEANE plan or a bill',
  problem: 'Something is not working',
  idea: 'An idea or a request',
  other: 'Something else',
}
/**
 * What happened to a request: kept here (no help address is set), test (email in test mode, not
 * sent), accepted by the email service, failed, or not known yet.
 */
export type SupportStatus = 'kept' | 'test' | 'accepted' | 'failed' | 'unknown'
export const supportStatusWords: Record<SupportStatus, string> = {
  kept: 'Kept on this server; not sent',
  test: 'Not sent: email is in test mode',
  accepted: 'Sent to the SALEANE team',
  failed: 'Could not be sent',
  unknown: 'Sending; not known yet',
}
export type SupportRequestView = {
  id: string
  topic: SupportTopic
  message: string
  page: string | null
  studio: string | null
  status: SupportStatus
  createdAt: number
}
export type SupportAnswer = {
  requests: SupportRequestView[]
  email: string
  delivery: 'kept' | 'test' | 'email'
  id?: string
}
