import type { Appointment, BusinessState } from './model'
import { operations } from './operations'
import { localDate } from './patchTests'
import { consentRecords, wordingFor } from './consent'
import type { Role } from './operations'
import { isOpen, serviceLabel, withdrawnOffer } from './waitlist'

/**
 * LOCAL-03 (PRD GOV-01): data exports and erasure review.
 *
 * Every rule here is a default awaiting the owner's and a privacy adviser's confirmation (see
 * docs/PRIVACY.md). The same functions build an export on the server and in the browser demo, so
 * both produce the same shape. Nothing here deletes or rewrites a record.
 *
 * Client export (a subject access copy): owner and manager. It holds what the studio records
 * about one person: profile, consent, booked visit terms, the receipts, payments and refunds for
 * those visits, timeline, unsent messages with their real status, and client connections as a
 * type only. Another person's name or details never appear (third-party data); neither do
 * credentials, sessions, invitations, request receipts, booking holds, the audit log or internal
 * record identifiers. Visits are referred to as V1, V2… within the file.
 *
 * Studio export: owner only. The one studio's records plus team names, emails and roles, never
 * password hashes, session or invitation tokens, booking holds, other studios or the audit log.
 */
export const PRIVACY_EXPORT_VERSION = 1
const PRIVACY_ROLES = {
  'client.export': ['owner', 'manager'],
  'client.erasure': ['owner', 'manager'],
  'studio.export': ['owner'],
} as const satisfies Record<string, readonly Role[]>
export type PrivacyAction = keyof typeof PRIVACY_ROLES
export function canPrivacy(role: Role, action: PrivacyAction) {
  return (PRIVACY_ROLES[action] as readonly Role[]).includes(role)
}

/** Status words for a message that SALEANE has never delivered. */
const MESSAGE_STATUS = {
  draft: 'Draft. Not sent.',
  queued: 'Queued in SALEANE. Not sent: no delivery service is configured.',
  suppressed: 'Suppressed after marketing consent was withdrawn. Not sent.',
} as const
const METHOD = {
  demo_card: 'Demo card (fictional, no money moved)',
  demo_cash: 'Demo cash (fictional, no money moved)',
  cash: 'Cash received at the studio',
  external_card: 'Card taken on an external terminal',
  card: 'Card processed by the payment provider',
  previous_system: 'Paid to the studio’s previous booking system',
} as const
const THIRD_PARTY = 'Linked to another client. Their details are withheld as third-party data.'
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export type ExportMeta = { generatedAt: string; generatedBy: string }
export type PreviewSection = { label: string; count: number }
export type ExportPreview = {
  title: string
  sections: PreviewSection[]
  excluded: string[]
  notes: string[]
}

function studioHeading(state: BusinessState) {
  const { name, locationName, address, region } = state.organisation
  return { name, locationName, address, region, sandbox: operations(state).mode === 'sandbox' }
}

export function clientExport(state: BusinessState, clientId: string, meta: ExportMeta) {
  const client = state.clients.find((c) => c.id === clientId)
  if (!client) throw new Error('This client was not found.')
  const ops = operations(state)
  const visits = state.appointments
    .filter((a) => a.clientId === client.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
  const ref = new Map(visits.map((a, index) => [a.id, `V${index + 1}`]))
  const visitRef = (id?: string) => (id ? ref.get(id) : undefined)
  const name = (rows: { id: string; name: string }[], id: string) =>
    rows.find((row) => row.id === id)?.name ?? 'Not recorded'
  const sales = state.sales
    .filter((s) => ref.has(s.appointmentId))
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt))
  const receipt = (saleId?: string) => sales.find((s) => s.id === saleId)?.receiptNumber
  /** The client's visit a refund belongs to, through its receipt or its deposit or fee payment. */
  const refundVisit = (r: { saleId?: string; paymentId?: string }) => {
    const visit = r.saleId
      ? sales.find((s) => s.id === r.saleId)?.appointmentId
      : state.payments.find((p) => p.id === r.paymentId)?.appointmentId
    return visit && ref.has(visit) ? visit : undefined
  }
  const events = state.events
    .filter((e) => e.clientId === client.id)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  return {
    format: 'saleane.client-export',
    version: PRIVACY_EXPORT_VERSION,
    ...meta,
    studio: studioHeading(state),
    money: { currency: state.organisation.currency, amounts: 'minor units (pence or cents)' },
    subject: {
      name: client.name,
      email: client.email,
      phone: client.phone,
      goodToRemember: client.preferences,
      clientSince: client.createdAt,
      ...(client.birthday ? { birthday: client.birthday } : {}),
    },
    consent: {
      emailMarketing: client.marketingConsent,
      history: events
        .filter((e) => e.type === 'consent')
        .map((e) => ({ occurredAt: e.occurredAt, change: e.title, detail: e.detail })),
      // V1.5: each permission given or withdrawn, with the words they agreed to and where.
      records: consentRecords(state)
        .filter((r) => r.clientId === client.id)
        .map((r) => ({
          recordedAt: r.recordedAt,
          channel: r.channel,
          purpose: r.purpose,
          given: r.given,
          ...(r.wordingVersion
            ? {
                wordingVersion: r.wordingVersion,
                wording: wordingFor(state, r.wordingVersion)?.text ?? '',
              }
            : {}),
          source: r.source,
          recordedBy: r.actor,
        })),
    },
    visits: visits.map((a: Appointment) => ({
      visit: ref.get(a.id)!,
      date: a.date,
      time: clock(a.startMinutes),
      service: a.bookedServiceName ?? name(state.services, a.serviceId),
      professional: name(state.staff, a.staffId),
      room: name(state.resources, a.resourceId),
      status: a.status,
      bookedThrough: a.source,
      bookedAt: a.createdAt,
      bookedPriceMinor: a.bookedPriceMinor,
      bookedDepositMinor: a.bookedDepositMinor,
      durationMinutes: a.bookedDurationMinutes,
      ...(a.rebookedFromId && ref.has(a.rebookedFromId)
        ? { rebookedFrom: ref.get(a.rebookedFromId) }
        : {}),
    })),
    receipts: sales.map((s) => ({
      visit: ref.get(s.appointmentId)!,
      receiptNumber: s.receiptNumber ?? 'Not numbered',
      paidAt: s.paidAt,
      method: METHOD[s.method],
      serviceMinor: s.serviceMinor,
      discountMinor: s.discountMinor ?? 0,
      taxMinor: s.taxMinor ?? 0,
      taxLabel: s.taxLabel ?? '',
      taxIncluded: !!s.taxInclusive,
      tipMinor: s.tipMinor,
      depositAppliedMinor: s.depositAppliedMinor,
      ...(s.retail
        ? {
            products: s.retail.lines.map((line) => ({
              name: line.name,
              quantity: line.quantity,
              unitMinor: line.unitMinor,
            })),
          }
        : {}),
      totalMinor: s.totalMinor,
      balanceMinor: s.balanceMinor,
      ...(s.giftCardMinor ? { paidByGiftCardMinor: s.giftCardMinor } : {}),
      ...(s.reference ? { reference: s.reference } : {}),
    })),
    /** V2: products bought without a visit. */
    productPurchases: (state.counterSales ?? [])
      .filter((sale) => sale.clientId === client.id)
      .map((sale) => ({
        receiptNumber: sale.receiptNumber,
        paidAt: sale.paidAt,
        method: METHOD[sale.method],
        products: sale.retail.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unitMinor: line.unitMinor,
        })),
        totalMinor: sale.totalMinor,
      })),
    payments: state.payments
      .filter((p) => ref.has(p.appointmentId))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .map((p) => ({
        visit: ref.get(p.appointmentId)!,
        kind: p.kind,
        amountMinor: p.amountMinor,
        recordedAt: p.recordedAt,
        method: METHOD[p.method],
        ...(p.reference ? { reference: p.reference } : {}),
      })),
    refunds: ops.refunds
      .filter((r) => refundVisit(r))
      .map((r) => ({
        visit: ref.get(refundVisit(r)!)!,
        receiptNumber: receipt(r.saleId) ?? (r.paymentId ? 'Deposit or fee' : 'Not numbered'),
        amountMinor: r.amountMinor,
        reason: r.reason,
        reference: r.reference,
        recordedAt: r.createdAt,
      })),
    timeline: events.map((e) => ({
      occurredAt: e.occurredAt,
      type: e.type,
      // Relationship events name the other client in their wording; that person is not the subject.
      title: e.type === 'relationship' ? 'Client connection' : e.title,
      detail: e.type === 'relationship' ? THIRD_PARTY : e.detail,
      recordedBy: e.actor,
      ...(visitRef(e.appointmentId) ? { visit: visitRef(e.appointmentId) } : {}),
    })),
    messages: ops.messages
      .filter((m) => m.clientId === client.id)
      .map((m) => ({
        createdAt: m.createdAt,
        purpose: m.purpose,
        subject: m.subject,
        body: m.body,
        status: m.status,
        delivery:
          m.status === 'suppressed' && withdrawnOffer(state, m.id)
            ? 'Withdrawn before it was sent: the waitlist request it offered a time for had ended. Not sent.'
            : MESSAGE_STATUS[m.status],
        ...(visitRef(m.appointmentId) ? { visit: visitRef(m.appointmentId) } : {}),
      })),
    connections: state.relationships
      .filter((r) => r.fromClientId === client.id || r.toClientId === client.id)
      .map((r) => ({
        type: r.type,
        role:
          r.type === 'household'
            ? 'Shares a household with another client'
            : r.fromClientId === client.id
              ? 'Introduced another client'
              : 'Introduced by another client',
        since: r.createdAt,
      })),
    // PILOT-03: credit or money owed brought across from the studio's previous system.
    carriedOver: (ops.balances ?? [])
      .filter((b) => b.clientId === client.id)
      .map((b) => ({
        kind: b.kind,
        amountMinor: b.amountMinor,
        note: b.note,
        from: ops.imports?.find((batch) => batch.id === b.importId)?.source ?? 'Previous system',
        recordedAt: b.createdAt,
        ...(b.settled ? { closedAt: b.settled.at, closedNote: b.settled.note } : {}),
      })),
    // V1.5: calls from this client's number that the studio missed, and when it called back.
    missedCalls: (ops.missedCalls ?? [])
      .filter((c) => c.clientId === client.id)
      .map((c) => ({
        from: c.number,
        firstCall: c.at,
        lastCall: c.lastAt,
        calls: c.calls,
        ...(c.calledBackAt ? { calledBackAt: c.calledBackAt } : {}),
        ...(c.appointmentId && ref.has(c.appointmentId)
          ? { bookedVisit: ref.get(c.appointmentId) }
          : {}),
      })),
    // V1.5: the private feedback this client gave about their visits.
    feedback: (state.feedback ?? [])
      .filter((f) => f.clientId === client.id)
      .map((f) => ({
        visit: ref.get(f.appointmentId),
        visitRating: f.visitRating,
        practitionerRating: f.practitionerRating,
        comment: f.comment,
        givenAt: f.createdAt,
      })),
    // V1.5: times this client asked to be told about, and how each request ended.
    waitlist: (state.waitlist ?? [])
      .filter((e) => e.clientId === client.id)
      .map((e) => ({
        service: serviceLabel(state, e),
        with: e.staffId
          ? (state.staff.find((p) => p.id === e.staffId)?.name ?? 'Professional')
          : 'Anyone',
        fromDate: e.fromDate,
        toDate: e.toDate,
        times: e.times,
        note: e.note,
        askedBy: e.source === 'guest' ? 'The client' : 'The studio',
        askedAt: e.createdAt,
        // A request whose dates passed is kept as waiting in the record but is no longer open.
        status:
          e.status === 'waiting' && !isOpen(state, e, meta.generatedAt)
            ? ('dates passed' as const)
            : e.status,
        ...(e.closedAt ? { closedAt: e.closedAt } : {}),
        ...(e.removedReason ? { reason: e.removedReason } : {}),
        offersDrafted: (e.offers ?? []).length,
      })),
    // V1.5: packages and memberships this client bought, with what was paid, used and returned.
    plans: (state.holdings ?? [])
      .filter((h) => h.clientId === client.id)
      .map((h) => ({
        kind: h.kind,
        name: h.name,
        startedOn: h.startedOn,
        ...(h.endsOn ? { endsOn: h.endsOn } : {}),
        ...(h.paidUntil ? { paidUntil: h.paidUntil } : {}),
        status: h.status,
        payments: h.payments.map((p) => ({
          amountMinor: p.amountMinor,
          method: METHOD[p.method],
          recordedAt: p.recordedAt,
        })),
        visitsUsed: h.uses.map((u) => ({
          visit: ref.get(u.appointmentId),
          valueMinor: u.valueMinor,
        })),
        refunds: h.refunds.map((r) => ({
          amountMinor: r.amountMinor,
          reason: r.reason,
          recordedAt: r.createdAt,
        })),
      })),
    // V1.5: gift cards and vouchers this client bought, and what each has paid for since.
    giftCards: (state.giftCards ?? [])
      .filter((c) => c.clientId === client.id)
      .map((c) => ({
        kind: c.kind === 'service' ? ('voucher' as const) : ('gift card' as const),
        ...(c.serviceName ? { treatment: c.serviceName } : {}),
        valueMinor: c.valueMinor,
        recipientName: c.recipientName,
        message: c.message,
        issuedOn: c.issuedOn,
        expiresOn: c.expiresOn,
        status: c.status,
        spentMinor: c.redemptions.reduce((sum, r) => sum + r.amountMinor, 0),
        returnedMinor: c.refunds.reduce((sum, r) => sum + r.amountMinor, 0),
      })),
    // V1.5: patch tests done for this client and what was seen.
    patchTests: (state.patchTests ?? [])
      .filter((t) => t.clientId === client.id)
      .map((t) => ({
        testedAt: t.testedAt,
        /** The studio's own date for the test, as shown on the client's page. */
        testedOn: localDate(state, t.testedAt),
        product: t.product,
        notes: t.notes,
        doneBy: state.staff.find((p) => p.id === t.staffId)?.name ?? 'Not recorded',
        recordedBy: t.actor,
        result: t.result?.outcome ?? 'not recorded',
        resultNotes: t.result?.notes ?? '',
      })),
    // V1.5: forms they filled in, with the questions as they were asked.
    forms: (state.formResponses ?? [])
      .filter((r) => r.clientId === client.id)
      .map((r) => {
        const form = (state.forms ?? []).find((f) => f.id === r.formId)
        const content = form?.versions.find((v) => v.version === r.version)?.content
        return {
          ...(ref.has(r.appointmentId) ? { visit: ref.get(r.appointmentId) } : {}),
          form: content?.title ?? 'Form',
          version: r.version,
          submittedAt: r.submittedAt,
          answers: (content?.questions ?? []).map((q) => ({
            question: q.label,
            answer: r.answers.find((a) => a.questionId === q.id)?.value ?? '',
          })),
          ...(content?.agreement ? { agreed: content.agreement, agreedAs: r.agreedName } : {}),
        }
      }),
  }
}
export type ClientExport = ReturnType<typeof clientExport>

export const CLIENT_EXPORT_EXCLUDED = [
  'Other clients’ names and details, including the people they are connected to',
  'Staff accounts, passwords, sign-in sessions and invitation links',
  'Internal record identifiers, request receipts and online booking holds',
  'The studio’s internal audit log',
  'Anything from another studio',
]

export function previewClientExport(file: ClientExport): ExportPreview {
  return {
    title: file.subject.name,
    sections: [
      { label: 'Profile and contact details', count: 1 },
      { label: 'Consent changes', count: file.consent.history.length },
      { label: 'Visits with their booked terms', count: file.visits.length },
      { label: 'Receipts', count: file.receipts.length },
      { label: 'Products bought without a visit', count: file.productPurchases.length },
      { label: 'Payments and deposits', count: file.payments.length },
      { label: 'Refunds', count: file.refunds.length },
      { label: 'Timeline entries', count: file.timeline.length },
      { label: 'Messages, none of them sent', count: file.messages.length },
      { label: 'Client connections, type only', count: file.connections.length },
      { label: 'Private feedback they gave', count: file.feedback.length },
      { label: 'Waitlist requests', count: file.waitlist.length },
      { label: 'Gift cards and vouchers they bought', count: file.giftCards.length },
      { label: 'Patch tests', count: file.patchTests.length },
      { label: 'Forms they filled in, answers as written', count: file.forms.length },
    ],
    excluded: CLIENT_EXPORT_EXCLUDED,
    notes: [
      'Notes, preferences, feedback comments and message text are included as written. Read them before sending, in case they mention someone else.',
      'Staff names appear where they recorded an entry or looked after a visit.',
      'Messages show their real status. SALEANE has no delivery service configured, so none was sent.',
      ...(file.studio.sandbox
        ? ['This is the fictional sandbox. Its money and people are not real.']
        : []),
    ],
  }
}

export type TeamMember = { name: string; email: string; role: Role; professional?: string }

export function studioExport(state: BusinessState, meta: ExportMeta, team: TeamMember[] = []) {
  const records = structuredClone(state)
  return {
    format: 'saleane.studio-export',
    version: PRIVACY_EXPORT_VERSION,
    ...meta,
    studio: studioHeading(state),
    money: { currency: state.organisation.currency, amounts: 'minor units (pence or cents)' },
    team: team.map(({ name, email, role, professional }) => ({
      name,
      email,
      role,
      ...(professional ? { professional } : {}),
    })),
    records: { ...records, operations: operations(records) },
  }
}
export type StudioExport = ReturnType<typeof studioExport>

export const STUDIO_EXPORT_EXCLUDED = [
  'Passwords and password hashes',
  'Sign-in sessions, invitation links and their tokens',
  'Online booking holds and their tokens',
  'Request receipts and the internal audit log',
  'Every other studio on this server',
]

export function previewStudioExport(file: StudioExport): ExportPreview {
  const r = file.records
  return {
    title: file.studio.name,
    sections: [
      { label: 'Team members (name, email and role)', count: file.team.length },
      { label: 'Clients', count: r.clients.length },
      { label: 'Visits', count: r.appointments.length },
      { label: 'Receipts', count: r.sales.length },
      { label: 'Payments and deposits', count: r.payments.length },
      { label: 'Refunds', count: r.operations.refunds.length },
      { label: 'Timeline entries', count: r.events.length },
      { label: 'Messages, none of them sent', count: r.operations.messages.length },
      { label: 'Client connections', count: r.relationships.length },
      { label: 'Private guest feedback, comments as written', count: (r.feedback ?? []).length },
      { label: 'Waitlist requests', count: (r.waitlist ?? []).length },
      { label: 'Gift cards and vouchers', count: (r.giftCards ?? []).length },
      { label: 'Patch tests', count: (r.patchTests ?? []).length },
      { label: 'Guest forms and their answers', count: (r.formResponses ?? []).length },
      { label: 'Email permission records', count: (r.consentRecords ?? []).length },
      {
        label: 'Services, professionals and spaces',
        count: r.services.length + r.staff.length + r.resources.length,
      },
      {
        label: 'Products and stock movements',
        count: r.operations.products.length + r.operations.movements.length,
      },
    ],
    excluded: STUDIO_EXPORT_EXCLUDED,
    notes: [
      'This file holds every client’s personal details. Store it somewhere private and share it only with people entitled to see it.',
      ...((r.feedback ?? []).length
        ? [
            'It includes guests’ private feedback comments as written, which only owners and managers normally see.',
          ]
        : []),
      'Record identifiers are kept so the file can be imported or reconciled later.',
      ...(file.studio.sandbox
        ? ['This is the fictional sandbox. Its money and people are not real.']
        : []),
    ],
  }
}

/** `count` is null where the record lives outside the studio state (the server audit log). */
export type ErasureItem = { label: string; count: number | null; reason: string }
export type ErasureReview = {
  client: string
  removable: ErasureItem[]
  kept: ErasureItem[]
  upcomingVisits: number
  marketingConsent: boolean
  decisions: string[]
}

/**
 * What an erasure request would touch. This only describes; SALEANE deletes nothing until an
 * owner or manager approves it (see dataRetention.ts).
 */
export function erasureReview(
  state: BusinessState,
  clientId: string,
  today: string,
): ErasureReview {
  const client = state.clients.find((c) => c.id === clientId)
  if (!client) throw new Error('This client was not found.')
  const ops = operations(state)
  const visits = state.appointments.filter((a) => a.clientId === client.id)
  const visitIds = new Set(visits.map((a) => a.id))
  const sales = state.sales.filter((s) => visitIds.has(s.appointmentId))
  const events = state.events.filter((e) => e.clientId === client.id)
  const upcomingVisits = visits.filter(
    (a) => ['confirmed', 'arrived'].includes(a.status) && a.date >= today,
  ).length
  return {
    client: client.name,
    removable: [
      {
        label: 'Email address and telephone number',
        count: 1,
        reason: 'Needed only to arrange visits and send updates.',
      },
      {
        label: 'Good to remember',
        count: client.preferences.trim() ? 1 : 0,
        reason:
          'Service preferences help care, but are not needed for any record that must be kept.',
      },
      {
        label: 'Relationship notes',
        count: events.filter((e) => e.type === 'note').length,
        reason: 'Free-text notes. Not linked to money.',
      },
      {
        label: 'Unsent messages (drafts, queued and suppressed)',
        count: ops.messages.filter((m) => m.clientId === client.id).length,
        reason: 'None was ever sent, so no delivery record depends on them.',
      },
      {
        label: 'Missed calls from their number',
        count: (ops.missedCalls ?? []).filter((c) => c.clientId === client.id).length,
        reason: 'Only for calling them back. Not linked to money.',
      },
      {
        label: 'Waitlist requests',
        count: (state.waitlist ?? []).filter((e) => e.clientId === client.id).length,
        reason: 'Only for arranging an earlier or free time. Not linked to money.',
      },
      {
        label: 'Private feedback (ratings and comments)',
        count: (state.feedback ?? []).filter((f) => f.clientId === client.id).length,
        reason:
          'What the person told the studio privately. Not linked to money; the averages would no longer count it.',
      },
      {
        label: 'Client connections',
        count: state.relationships.filter(
          (r) => r.fromClientId === client.id || r.toClientId === client.id,
        ).length,
        reason: 'Only the link would go. The other person’s record stays as it is.',
      },
    ],
    kept: [
      {
        label: 'Receipts',
        count: sales.length,
        reason: 'Tax and accounting records, kept 6 years in the UK and 7 years in the US.',
      },
      {
        label: 'Payments and deposits',
        count: state.payments.filter((p) => visitIds.has(p.appointmentId)).length,
        reason: 'Money history is never rewritten; receipts and reconciliation depend on it.',
      },
      {
        label: 'Refunds',
        count: ops.refunds.filter(
          (r) =>
            sales.some((s) => s.id === r.saleId) ||
            state.payments.some((p) => p.id === r.paymentId && visitIds.has(p.appointmentId)),
        ).length,
        reason: 'Part of the money history for each receipt.',
      },
      {
        label: 'Gift cards and vouchers they bought',
        count: (state.giftCards ?? []).filter((c) => c.clientId === client.id).length,
        reason:
          'Money held for whoever has the card. Its balance and spending must stay accountable.',
      },
      {
        label: 'Patch tests',
        count: (state.patchTests ?? []).filter((t) => t.clientId === client.id).length,
        reason:
          'Shows the studio checked for a reaction before a treatment, in case of a later complaint or claim.',
      },
      {
        label: 'Forms they filled in',
        count: (state.formResponses ?? []).filter((r) => r.clientId === client.id).length,
        reason: 'Shows what they told the studio and agreed to before a visit.',
      },
      {
        label: 'Booked visit terms',
        count: visits.length,
        reason: 'Receipts, deposits and the diary depend on the original service, price and time.',
      },
      {
        label: 'Consent history',
        count:
          events.filter((e) => e.type === 'consent').length +
          consentRecords(state).filter((r) => r.clientId === client.id).length,
        reason: 'Shows what the person agreed to and any opt-out, so they are not contacted again.',
      },
      {
        label: 'Audit history',
        count: null,
        reason:
          'Records who did what and when, without the person’s details. Kept for accountability.',
      },
    ],
    upcomingVisits,
    marketingConsent: client.marketingConsent,
    decisions: [
      'An owner or manager approves the deletion; nothing is removed automatically.',
      'Whether the name on kept receipts stays or is replaced with a reference.',
      'How the studio confirms a request really comes from the client.',
      ...(upcomingVisits
        ? [
            `${upcomingVisits} upcoming visit${upcomingVisits === 1 ? '' : 's'} would need cancelling or completing first.`,
          ]
        : []),
    ],
  }
}

const amount = (minor: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100)

/** A plain-text reading of a client export, for people who will not open JSON. */
export function clientExportText(file: ClientExport, locale = 'en-GB') {
  const cur = file.money.currency
  const lines = [
    `Personal data held by ${file.studio.name}`,
    `Prepared ${file.generatedAt} by ${file.generatedBy}`,
    ...(file.studio.sandbox ? ['Fictional sandbox data. Nothing here is real.'] : []),
    '',
    'PROFILE',
    `Name: ${file.subject.name}`,
    `Email: ${file.subject.email}`,
    `Telephone: ${file.subject.phone || 'Not recorded'}`,
    `Client since: ${file.subject.clientSince.slice(0, 10)}`,
    `Good to remember: ${file.subject.goodToRemember || 'Nothing recorded'}`,
    `Email marketing: ${file.consent.emailMarketing ? 'agreed' : 'not agreed'}`,
    ...file.consent.records.map(
      (r) =>
        `  ${r.recordedAt.slice(0, 10)} · ${r.given ? `agreed to version ${r.wordingVersion}: “${r.wording}”` : 'withdrawn'} · ${r.source}`,
    ),
    '',
    `VISITS (${file.visits.length})`,
    ...file.visits.map(
      (v) =>
        `${v.visit} · ${v.date} ${v.time} · ${v.service} with ${v.professional} · ${v.status} · booked at ${amount(v.bookedPriceMinor, cur, locale)}`,
    ),
    '',
    `RECEIPTS (${file.receipts.length})`,
    ...file.receipts.map(
      (r) =>
        `${r.receiptNumber} · ${r.visit} · ${r.paidAt.slice(0, 10)} · total ${amount(r.totalMinor, cur, locale)} · ${r.method}${
          r.products
            ? ` · products: ${r.products.map((p) => `${p.quantity} × ${p.name} at ${amount(p.unitMinor, cur, locale)}`).join(', ')}`
            : ''
        }`,
    ),
    '',
    `PRODUCTS BOUGHT WITHOUT A VISIT (${file.productPurchases.length})`,
    ...file.productPurchases.map(
      (p) =>
        `${p.receiptNumber} · ${p.paidAt.slice(0, 10)} · ${p.products.map((x) => `${x.quantity} × ${x.name}`).join(', ')} · total ${amount(p.totalMinor, cur, locale)} · ${p.method}`,
    ),
    '',
    `PAYMENTS AND DEPOSITS (${file.payments.length})`,
    ...file.payments.map(
      (p) =>
        `${p.visit} · ${p.kind} · ${amount(p.amountMinor, cur, locale)} · ${p.recordedAt.slice(0, 10)} · ${p.method}`,
    ),
    '',
    `REFUNDS (${file.refunds.length})`,
    ...file.refunds.map(
      (r) =>
        `${r.receiptNumber} · ${amount(r.amountMinor, cur, locale)} · ${r.recordedAt.slice(0, 10)} · ${r.reason}`,
    ),
    '',
    `CARRIED OVER FROM A PREVIOUS SYSTEM (${file.carriedOver.length})`,
    ...file.carriedOver.map(
      (b) =>
        `${b.kind === 'credit' ? 'Credit' : 'Owed'} · ${amount(b.amountMinor, cur, locale)} · from ${b.from} · ${b.closedAt ? `closed ${b.closedAt.slice(0, 10)}` : 'open'}`,
    ),
    '',
    `FEEDBACK GIVEN (${file.feedback.length})`,
    ...file.feedback.map(
      (f) =>
        `${f.givenAt.slice(0, 10)} · visit ${f.visitRating}/5 · care ${f.practitionerRating}/5${f.comment ? ` · ${f.comment}` : ''}`,
    ),
    '',
    `WAITLIST REQUESTS (${file.waitlist.length})`,
    ...file.waitlist.map(
      (e) =>
        `${e.service} with ${e.with} · ${e.fromDate} to ${e.toDate} · ${e.status}${e.note ? ` · ${e.note}` : ''}`,
    ),
    '',
    `PACKAGES AND MEMBERSHIPS (${file.plans.length})`,
    ...file.plans.map(
      (p) =>
        `${p.name} · ${p.kind} · from ${p.startedOn} · paid ${amount(
          p.payments.reduce((sum, x) => sum + x.amountMinor, 0),
          cur,
          locale,
        )} · ${p.visitsUsed.length} visits used · ${p.status}`,
    ),
    '',
    `GIFT CARDS AND VOUCHERS BOUGHT (${file.giftCards.length})`,
    ...file.giftCards.map(
      (c) =>
        `${c.treatment ? `${c.treatment} voucher` : 'Gift card'} · ${amount(c.valueMinor, cur, locale)}${c.recipientName ? ` for ${c.recipientName}` : ''} · ${c.issuedOn} to ${c.expiresOn} · spent ${amount(c.spentMinor, cur, locale)} · ${c.status}`,
    ),
    '',
    `PATCH TESTS (${file.patchTests.length})`,
    ...file.patchTests.map(
      (t) =>
        `${t.testedOn} · ${t.product} · by ${t.doneBy} · ${t.result}${t.resultNotes ? ` · ${t.resultNotes}` : ''}${t.notes ? ` · ${t.notes}` : ''}`,
    ),
    '',
    `FORMS (${file.forms.length})`,
    ...file.forms.flatMap((f) => [
      `${f.submittedAt.slice(0, 10)} · ${f.form} (version ${f.version})${f.agreedAs ? ` · agreed as ${f.agreedAs}` : ''}`,
      ...f.answers.map((a) => `  ${a.question}: ${a.answer || '–'}`),
    ]),
    '',
    `MESSAGES (${file.messages.length}), none sent`,
    ...file.messages.map((m) => `${m.createdAt.slice(0, 10)} · ${m.subject} · ${m.delivery}`),
    '',
    `CONNECTIONS (${file.connections.length})`,
    ...file.connections.map((c) => `${c.role} · since ${c.since.slice(0, 10)}`),
    '',
    `TIMELINE (${file.timeline.length})`,
    ...file.timeline.map((t) => `${t.occurredAt.slice(0, 10)} · ${t.title} · ${t.detail}`),
  ]
  return `${lines.join('\n')}\n`
}
