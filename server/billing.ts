import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { usedEach } from '../lumane'
import { mailBilling } from './accountMail'
import { fail } from './http'
import type { Context, Org, Route } from './context'
import { storedUsage } from './aiUsage'
import {
  HOSTED_MINUTES,
  TEST_CARDS,
  stripeProvider,
  testPaymentProvider,
} from './payments/providers'
import type { ChargeRecord, PaymentEvent, PaymentProvider, PayOutcome } from './payments/providers'
import { operations } from '../src/domain/operations'
import { places } from '../src/domain/locations'
import { fullDateLabel, money } from '../src/domain/format'
import { venueDate } from '../src/domain/tillCount'
import {
  GRACE_DAYS,
  LOCK_DAYS,
  PRICE,
  RETRY_DAYS,
  TRIAL_DAYS,
  allowanceFor,
  marketingEmailsFor,
  bookingPeople,
} from '../src/domain/pricing'
import type { PriceRegion } from '../src/domain/pricing'
import {
  ADD_ON_NAMES,
  DAY_MS,
  addOnBill,
  monthAfter,
  monthBill,
  nextRetry,
  lockedMessage,
  readOnlyMessage,
  taxed,
} from '../src/domain/billing'
import type {
  AddOn,
  Bill,
  BillingSummary,
  BillingView,
  InvoiceStatus,
  InvoiceView,
  PlanStatus,
  StopReason,
} from '../src/domain/billing'

type PlanRow = {
  organisation_id: string
  status: PlanStatus
  stop_reason: StopReason | null
  trial_ends_at: number
  trial_warned_at: number | null
  anchor_day: number | null
  period_start: number | null
  period_end: number | null
  plus: number
  plus_next: number
  phone: number
  phone_next: number
  cancel_at_period_end: number
  overdue_since: number | null
  next_attempt_at: number | null
  card_customer_ref: string | null
  card_method_ref: string | null
  card_brand: string | null
  card_last4: string | null
  card_exp_month: number | null
  card_exp_year: number | null
  /** Set by a restore: nothing is charged by itself until the payments have been checked. */
  held_at: number | null
  /** When a read-only studio locks, and when it did: only the owner can open it, to pay. */
  lock_at: number | null
  locked_at: number | null
  created_at: number
  updated_at: number
}
type InvoiceRow = {
  id: string
  organisation_id: string
  number: string
  kind: 'month' | AddOn
  period_start: number
  period_end: number
  plus: number
  phone: number
  currency: 'GBP' | 'USD'
  lines: string
  subtotal_minor: number
  tax_minor: number
  tax_label: string | null
  total_minor: number
  status: InvoiceStatus
  test: number
  attempt_key: string | null
  attempts: number
  charged_at: number | null
  provider_ref: string | null
  detail: string | null
  created_at: number
  paid_at: number | null
  closed_at: number | null
}
type SetupRow = {
  id: string
  organisation_id: string
  account_id: string
  status: 'started' | 'saved' | 'left' | 'failed'
  then_pay: number
  provider_ref: string | null
  created_at: number
}
type Account = { id: string; name: string; email: string }
type Extras = { plus: boolean; phone: boolean }
const isAddOn = (kind: string | undefined) => kind === 'plus' || kind === 'phone'

/** A payment with no clear answer is asked about again, with the same key, after this long. */
const RECHECK_MS = 10 * 60000
/** Below this a part-month bill is not worth a card charge; the rest of the month is free. */
const SMALLEST_CHARGE_MINOR = 100
/** Bills shown at once; older ones come a page at a time. */
const BILLS_PAGE = 24
const SETTINGS = '/settings?section=billing'
const RESTORED =
  'Payments are being checked with the card service after SALEANE was restored from a backup. Try again in a few minutes.'

/**
 * NEXT-02: SALEANE's own card account for charging studios, separate from the studios' card
 * accounts for their guests. Unset is test mode: the card is chosen on SALEANE's stand-in page and
 * nothing is charged. Stripe switches on only when both keys are present; it follows Stripe's
 * published API (a Checkout page to save the card, then off-session charges) and has not been run
 * against a real account.
 */
export function billingProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  origin = 'http://127.0.0.1:5173',
): PaymentProvider {
  const name = env.SALEANE_BILLING_PROVIDER?.trim() || 'test'
  if (name === 'test') return testBillingProvider(origin.replace(/\/$/, ''))
  if (name !== 'stripe') throw new Error(`Unknown billing provider "${name}".`)
  const missing = ['BILLING_STRIPE_SECRET_KEY', 'BILLING_STRIPE_WEBHOOK_SECRET'].filter(
    (key) => !env[key]?.trim(),
  )
  if (missing.length) throw new Error(`Set ${missing.join(' and ')} to charge studios.`)
  return stripeProvider({
    secretKey: env.BILLING_STRIPE_SECRET_KEY!.trim(),
    webhookSecret: env.BILLING_STRIPE_WEBHOOK_SECRET!.trim(),
  })
}

/** The test card provider, with its card page for the owner rather than for a guest. */
export function testBillingProvider(origin: string): PaymentProvider {
  const base = testPaymentProvider(origin)
  return {
    ...base,
    async hosted(input) {
      const opened = await base.hosted(input)
      return opened.ok
        ? { ...opened, url: `${origin}/billing/test-card#${input.attemptId}` }
        : opened
    },
  }
}

const routeInput = {
  addOn: z.object({ on: z.boolean() }).strict(),
  stop: z.object({ stop: z.boolean() }).strict(),
  empty: z.object({}).strict(),
  bills: z
    .object({
      before: z
        .string()
        .max(40)
        .regex(/^\d+\.\d+$/),
    })
    .strict(),
  testCard: z
    .object({ outcome: z.enum(['save', 'cancel']), card: z.enum(['4242', '0002']) })
    .strict(),
}

/** What a read-only studio can still do: pay, look after privacy, and shut doors for safety. */
function stillAllowed(path: string[], body: unknown) {
  return (
    path[3] === 'billing' ||
    path[3] === 'privacy' ||
    (path[3] === 'membership' && (body as { role?: unknown } | null)?.role === 'remove') ||
    (path[3] === 'api-keys' && path[5] === 'revoke') ||
    (path[3] === 'diary-links' && path[5] === 'stop') ||
    (path[3] === 'guest-links' && path[4] === 'revoke') ||
    (path[3] === 'connections' && path[4] === 'pause-all')
  )
}

/**
 * NEXT-02: studios paying for SALEANE. Each real studio has one plan: a free trial, then each month
 * billed in advance for every open location, with Plus if chosen. A failed payment is tried again
 * on the retry days while the studio keeps working; after the grace days, or when a trial ends
 * without a card, or when the owner stops, the studio is read only. Sample studios are never
 * charged. A bill is charged by claiming it first, so one bill is never charged twice at once,
 * and an unclear answer is asked about again with the same key rather than charged afresh.
 */
export function createBilling(ctx: Context, provider: PaymentProvider) {
  const { db, now } = ctx
  const test = !provider.live
  let running = false
  let timer: ReturnType<typeof setInterval> | undefined

  const regionOf = (org: Org): PriceRegion => org.state.organisation.region
  const locationsOf = (org: Org) => places(org.state).length
  // People who take bookings, counted afresh for every bill.
  const peopleOf = (org: Org) => bookingPeople(org.state)
  const real = (org: Org) => operations(org.state).mode === 'local'
  const plan = (orgId: string) =>
    db.get<PlanRow>('SELECT * FROM studio_plans WHERE organisation_id=?', orgId)
  const invoice = (id: string) => db.get<InvoiceRow>('SELECT * FROM studio_invoices WHERE id=?', id)
  const waiting = (orgId: string) =>
    !!db.get(
      "SELECT 1 FROM studio_invoices WHERE organisation_id=? AND status IN ('charging','unknown')",
      orgId,
    )
  const openMonth = (orgId: string) =>
    db.get<InvoiceRow>(
      "SELECT * FROM studio_invoices WHERE organisation_id=? AND kind='month' AND status='open' ORDER BY created_at DESC",
      orgId,
    )
  const anchorOf = (at: number) => new Date(at).getUTCDate()
  /** What the next month's bill carries: the add-ons chosen for it. */
  const chosen = (row: PlanRow): Extras => ({ plus: !!row.plus_next, phone: !!row.phone_next })
  /** NEXT-17: calls can reach the AI on this server, so the phone receptionist can be bought. */
  const phoneConnected = () => !!ctx.phone && ctx.voice.live && !!ctx.voice.calls && ctx.ai.live
  /** An add-on paid for part way through a month: on now, and on the bills after. */
  const turnOn = (addOn: AddOn, orgId: string, time: number) =>
    db.run(
      `UPDATE studio_plans SET ${addOn}=1,${addOn}_next=1,updated_at=? WHERE organisation_id=?`,
      time,
      orgId,
    )
  const nextBill = (org: Org, row: PlanRow) =>
    monthBill(regionOf(org), locationsOf(org), !!row.plus_next, peopleOf(org), !!row.phone_next)

  /** A real studio's plan, begun with its free trial the first time anything asks. */
  function planFor(org: Org): PlanRow | null {
    if (!real(org)) return null
    const found = plan(org.id)
    if (found) return found
    const time = now()
    db.run(
      "INSERT OR IGNORE INTO studio_plans(organisation_id,status,trial_ends_at,created_at,updated_at) VALUES(?,'trial',?,?,?)",
      org.id,
      time + TRIAL_DAYS * DAY_MS,
      time,
      time,
    )
    return plan(org.id)!
  }

  /**
   * The studio's AI allowance now: its locations, Plus and the phone receptionist once paid for,
   * and nothing when stopped.
   */
  function allowance(org: Org) {
    const row = planFor(org)
    return allowanceFor({
      locations: locationsOf(org),
      plus: !!row?.plus && row.status !== 'trial',
      phone: !!row?.phone && row.status !== 'trial',
      paused: row?.status === 'stopped',
    })
  }

  /** NEXT-14: the studio's marketing emails this month, counted the same way as its AI. */
  function marketingEmails(org: Org) {
    const row = planFor(org)
    return marketingEmailsFor({
      locations: locationsOf(org),
      plus: !!row?.plus && row.status !== 'trial',
      paused: row?.status === 'stopped',
    })
  }

  // Words for the owner's emails, in the studio's own dates and money.
  const when = (org: Org, at: number) =>
    fullDateLabel(
      venueDate(org.state.organisation.timeZone, new Date(at).toISOString()),
      org.state.organisation.locale,
    )
  const cash = (org: Org, minor: number) => {
    const price = PRICE[regionOf(org)]
    return money(minor, { locale: price.locale, currency: price.currency }, true)
  }
  const testNote = test
    ? '\n\nCard payments are in test mode, so no card is charged and no money moves.'
    : ''
  function tell(org: Org, subject: string, says: string) {
    for (const owner of db.all<Account>(
      "SELECT a.id,a.name,a.email FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.organisation_id=? AND m.role='owner'",
      org.id,
    ))
      mailBilling(ctx, owner, subject, `${says}${testNote}`)
  }

  /** The next bill number, in one sequence for real bills and another for test ones. */
  function nextNumber() {
    const prefix = test ? 'TEST' : 'SAL'
    const last = db.get<{ number: string }>(
      'SELECT number FROM studio_invoices WHERE number LIKE ? ORDER BY length(number) DESC, number DESC LIMIT 1',
      `${prefix}-%`,
    )
    return `${prefix}-${String(Number(last?.number.slice(prefix.length + 1) ?? 0) + 1).padStart(6, '0')}`
  }
  /** Makes a bill, numbered in one sequence for real bills and another for test ones. */
  function addInvoice(
    org: Org,
    kind: 'month' | AddOn,
    start: number,
    end: number,
    extras: Extras,
    bill: Bill,
    as?: { id: string; number: string; createdAt: number },
  ) {
    const id = as?.id ?? randomUUID()
    db.run(
      `INSERT INTO studio_invoices(id,organisation_id,number,kind,period_start,period_end,plus,phone,currency,lines,
         subtotal_minor,tax_minor,tax_label,total_minor,status,test,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
      id,
      org.id,
      as?.number ?? nextNumber(),
      kind,
      start,
      end,
      extras.plus ? 1 : 0,
      extras.phone ? 1 : 0,
      PRICE[regionOf(org)].currency,
      JSON.stringify(bill.lines),
      bill.subtotalMinor,
      bill.taxMinor,
      bill.taxLabel,
      bill.totalMinor,
      test ? 1 : 0,
      as?.createdAt ?? now(),
    )
    return invoice(id)!
  }

  /** The month starting at `start`, billed once however often it is asked for. */
  function monthInvoice(org: Org, row: PlanRow, start: number) {
    const existing = db.get<InvoiceRow>(
      "SELECT * FROM studio_invoices WHERE organisation_id=? AND kind='month' AND period_start=? AND status<>'void'",
      org.id,
      start,
    )
    if (existing) return existing
    return addInvoice(
      org,
      'month',
      start,
      monthAfter(start, row.anchor_day ?? anchorOf(start)),
      chosen(row),
      nextBill(org, row),
    )
  }

  /** A bill that could not be taken: the studio owes it and keeps working through the grace days. */
  function owe(org: Org, row: PlanRow, bill: InvoiceRow, detail: string) {
    const time = now()
    const since = row.overdue_since ?? time
    db.run("UPDATE studio_invoices SET status='open',detail=? WHERE id=?", detail, bill.id)
    db.run(
      `UPDATE studio_plans SET status='overdue',stop_reason=NULL,overdue_since=?,next_attempt_at=?,
         period_start=?,period_end=?,anchor_day=COALESCE(anchor_day,?),plus=?,phone=?,updated_at=?
       WHERE organisation_id=?`,
      since,
      nextRetry(since, time, RETRY_DAYS),
      bill.period_start,
      bill.period_end,
      anchorOf(bill.period_start),
      // The month that is owed is the one being worked, with each add-on only if its bill has it.
      bill.plus,
      bill.phone,
      time,
      org.id,
    )
    return { since, next: nextRetry(since, time, RETRY_DAYS) }
  }

  /**
   * Records what the card service said about one charge, inside the caller's transaction, and
   * returns the email to send once it is saved. A late or repeated answer changes nothing.
   */
  function record(key: string, outcome: PayOutcome, actorId: string | null) {
    {
      const bill = db.get<InvoiceRow>('SELECT * FROM studio_invoices WHERE attempt_key=?', key)
      if (!bill || bill.status !== 'charging') return null
      const org = ctx.systemOrg(bill.organisation_id)!
      const row = plan(org.id)!
      const time = now()
      const period = `${when(org, bill.period_start)} to ${when(org, bill.period_end)}`
      if (outcome.status === 'succeeded') {
        db.run(
          "UPDATE studio_invoices SET status='paid',provider_ref=?,detail=NULL,paid_at=?,closed_at=? WHERE id=?",
          outcome.providerRef,
          time,
          time,
          bill.id,
        )
        if (bill.kind === 'month')
          db.run(
            `UPDATE studio_plans SET status='active',stop_reason=NULL,period_start=?,period_end=?,
               anchor_day=COALESCE(anchor_day,?),plus=?,phone=?,overdue_since=NULL,next_attempt_at=NULL,
               cancel_at_period_end=0,lock_at=NULL,locked_at=NULL,updated_at=? WHERE organisation_id=?`,
            bill.period_start,
            bill.period_end,
            anchorOf(bill.period_start),
            bill.plus,
            bill.phone,
            time,
            org.id,
          )
        else turnOn(bill.kind, org.id, time)
        ctx.audit(org, actorId, test ? 'billing.test-paid' : 'billing.paid', bill.id, undefined, {
          fields: [{ f: 'totalMinor', to: bill.total_minor }],
        })
        return {
          status: 'paid' as const,
          mail: () =>
            test
              ? tell(
                  org,
                  `SALEANE bill ${bill.number} settled in test mode`,
                  `Bill ${bill.number} for ${org.state.organisation.name}, ${cash(org, bill.total_minor)} for ${period}, is marked as paid in test mode. It is in Settings, Plan and billing.`,
                )
              : tell(
                  org,
                  `Your SALEANE bill ${bill.number}`,
                  `We have taken ${cash(org, bill.total_minor)} from the card ending ${row.card_last4} for ${org.state.organisation.name}, ${period}. Bill ${bill.number} is in Settings, Plan and billing.`,
                ),
        }
      }
      if (outcome.status === 'failed') {
        ctx.audit(org, actorId, 'billing.failed', bill.id, undefined, {
          fields: [{ f: 'totalMinor', to: bill.total_minor }],
        })
        // An add-on part way through a month, or a fresh start after stopping, is simply not taken.
        if (bill.kind !== 'month' || row.status === 'stopped') {
          db.run(
            "UPDATE studio_invoices SET status='void',detail=?,closed_at=? WHERE id=?",
            `Not charged: ${outcome.detail}`,
            time,
            bill.id,
          )
          return { status: 'void' as const }
        }
        const { since, next } = owe(org, row, bill, outcome.detail)
        return {
          status: 'open' as const,
          mail: () =>
            tell(
              org,
              `We could not take the SALEANE payment for ${org.state.organisation.name}`,
              `We tried to take ${cash(org, bill.total_minor)} for ${period} from the card ending ${row.card_last4}, and it did not go through: ${outcome.detail} ${next ? `We will try again on ${when(org, next)}.` : 'We will not try the card again by ourselves.'} To keep everything working, pay or use another card in Settings, Plan and billing by ${when(org, since + GRACE_DAYS * DAY_MS)}. After that the studio becomes read only until it is paid: nothing is deleted and guests can still book.`,
            ),
        }
      }
      // Still being worked on, or no clear answer: ask again later with the same key.
      db.run(
        'UPDATE studio_invoices SET detail=? WHERE id=?',
        outcome.status === 'processing'
          ? 'The card service is still working on this payment.'
          : outcome.detail,
        bill.id,
      )
      return { status: 'charging' as const }
    }
  }
  function settle(key: string, outcome: PayOutcome, actorId: string | null): InvoiceStatus {
    const told = db.transaction(() => record(key, outcome, actorId))
    if (!told)
      return (
        db.get<{ status: InvoiceStatus }>(
          'SELECT status FROM studio_invoices WHERE attempt_key=?',
          key,
        )?.status ?? 'void'
      )
    told.mail?.()
    return told.status
  }

  /** Charges an open bill with the saved card, claiming it first so it is never charged twice. */
  async function charge(id: string, actorId: string | null): Promise<InvoiceStatus> {
    const claimed = db.transaction(() => {
      const bill = invoice(id)
      const row = bill && plan(bill.organisation_id)
      if (!bill || bill.status !== 'open' || !row?.card_method_ref) return null
      const key = `${bill.id}.${bill.attempts + 1}`
      db.run(
        "UPDATE studio_invoices SET status='charging',attempt_key=?,attempts=attempts+1,charged_at=? WHERE id=? AND status='open'",
        key,
        now(),
        bill.id,
      )
      return { bill, row, key }
    })
    if (!claimed) return invoice(id)?.status ?? 'void'
    return ask(claimed.key, claimed.bill, claimed.row, actorId)
  }
  async function ask(key: string, bill: InvoiceRow, row: PlanRow, actorId: string | null) {
    let outcome: PayOutcome
    try {
      outcome = await provider.chargeSaved({
        attemptId: key,
        amountMinor: bill.total_minor,
        currency: bill.currency,
        description: `SALEANE bill ${bill.number}`,
        card: {
          customerRef: row.card_customer_ref!,
          methodRef: row.card_method_ref!,
          last4: row.card_last4!,
        },
        // Enough to find the charge again, and to rebuild its bill, after a restore.
        marks: {
          studio: bill.organisation_id,
          bill: bill.id,
          number: bill.number,
          kind: bill.kind,
          start: String(bill.period_start),
          end: String(bill.period_end),
          plus: String(bill.plus),
          phone: String(bill.phone),
          anchor: String(row.anchor_day ?? anchorOf(bill.period_start)),
          subtotal: String(bill.subtotal_minor),
          tax: String(bill.tax_minor),
          made: String(bill.created_at),
        },
      })
    } catch (error) {
      outcome = {
        status: 'unknown',
        detail: error instanceof Error ? error.message : 'The card service did not answer.',
      }
    }
    return settle(key, outcome, actorId)
  }

  /** Read only, with every open bill cancelled: nobody owes for days they could not work. */
  function stop(org: Org, from: PlanStatus, reason: StopReason, actorId: string | null = null) {
    const stopped = db.transaction(() => {
      const time = now()
      // Thirty days after the last day paid for: the missed payment, or the end of the trial or plan.
      const lockAt =
        (reason === 'unpaid' ? (plan(org.id)?.overdue_since ?? time) : time) + LOCK_DAYS * DAY_MS
      const changed = db.run(
        `UPDATE studio_plans SET status='stopped',stop_reason=?,cancel_at_period_end=0,overdue_since=NULL,
           next_attempt_at=NULL,lock_at=?,locked_at=NULL,updated_at=? WHERE organisation_id=? AND status=?`,
        reason,
        lockAt,
        time,
        org.id,
        from,
      ).changes
      if (Number(changed) !== 1) return false
      db.run(
        "UPDATE studio_invoices SET status='void',detail=?,closed_at=? WHERE organisation_id=? AND status='open'",
        'Not charged: the studio became read only.',
        time,
        org.id,
      )
      ctx.audit(org, actorId, 'billing.read-only', org.id)
      return lockAt
    })
    if (!stopped) return
    const name = org.state.organisation.name
    tell(
      org,
      `${name} is now read only`,
      `${
        reason === 'trial_ended'
          ? `Your free trial of SALEANE has ended without a card, so ${name} is now read only.`
          : reason === 'unpaid'
            ? `The SALEANE bill for ${name} is still unpaid after ${GRACE_DAYS} days, so the studio is now read only.`
            : `As you asked, the SALEANE plan for ${name} has stopped, so the studio is now read only.`
      } Nothing has been deleted. Your team can still see and download everything, and guests can still book and manage their visits. On ${when(org, stopped)} the studio locks: only you will be able to open it, to pay or to download its records, and online booking closes. To carry on, pay in Settings, Plan and billing.`,
    )
  }

  /** A read-only studio's lock day has come: only the owner can open it, and booking closes. */
  function lock(row: PlanRow) {
    const org = ctx.systemOrg(row.organisation_id)
    if (!org) return
    const locked = db.transaction(() => {
      const changed = db.run(
        "UPDATE studio_plans SET locked_at=?,updated_at=? WHERE organisation_id=? AND status='stopped' AND locked_at IS NULL AND lock_at<=?",
        now(),
        now(),
        org.id,
        now(),
      ).changes
      if (Number(changed) !== 1) return false
      ctx.audit(org, null, 'billing.locked', org.id)
      return true
    })
    if (!locked) return
    const name = org.state.organisation.name
    tell(
      org,
      `${name} is now locked`,
      `The SALEANE bill for ${name} has not been paid, so the studio is now locked. Only you can open it, to pay or to download its records; your team cannot. Online booking is closed, and bookings already made still stand. Nothing has been deleted. To open it again for everyone, pay in Settings, Plan and billing.`,
    )
  }

  /** Three days before a trial ends, the owner hears what will happen. Once. */
  function warnTrial(row: PlanRow) {
    const org = ctx.systemOrg(row.organisation_id)
    if (!org) return
    const claimed = db.run(
      'UPDATE studio_plans SET trial_warned_at=? WHERE organisation_id=? AND trial_warned_at IS NULL',
      now(),
      row.organisation_id,
    ).changes
    if (Number(claimed) !== 1 || row.cancel_at_period_end) return
    const bill = nextBill(org, row)
    tell(
      org,
      `Your SALEANE free trial ends on ${when(org, row.trial_ends_at)}`,
      row.card_method_ref
        ? `Your free trial of SALEANE for ${org.state.organisation.name} ends on ${when(org, row.trial_ends_at)}. We will then take ${cash(org, bill.totalMinor)} for the first month from the card ending ${row.card_last4}. You can change or stop the plan in Settings, Plan and billing.`
        : `Your free trial of SALEANE for ${org.state.organisation.name} ends on ${when(org, row.trial_ends_at)}. To carry on, add a card in Settings, Plan and billing; the first month is ${cash(org, bill.totalMinor)}. Without a card, the studio becomes read only that day: nothing is deleted, your team can still see everything and guests can still book.`,
    )
  }

  async function endTrial(row: PlanRow) {
    const org = ctx.systemOrg(row.organisation_id)
    if (!org || waiting(org.id)) return
    if (row.cancel_at_period_end) return stop(org, 'trial', 'cancelled')
    if (!row.card_method_ref) return stop(org, 'trial', 'trial_ended')
    const bill = db.transaction(() => monthInvoice(org, row, row.trial_ends_at))
    await charge(bill.id, null)
  }

  async function renew(row: PlanRow) {
    const org = ctx.systemOrg(row.organisation_id)
    if (!org || waiting(org.id)) return
    if (row.cancel_at_period_end) return stop(org, 'active', 'cancelled')
    const bill = db.transaction(() => monthInvoice(org, row, row.period_end!))
    if (bill.status !== 'open') return
    if (row.card_method_ref) await charge(bill.id, null)
    else db.transaction(() => owe(org, row, bill, 'No card is saved for the SALEANE plan.'))
  }

  async function chase(row: PlanRow) {
    const org = ctx.systemOrg(row.organisation_id)
    if (!org || waiting(org.id)) return
    const time = now()
    if (time >= row.overdue_since! + GRACE_DAYS * DAY_MS) return stop(org, 'overdue', 'unpaid')
    if (row.next_attempt_at === null || row.next_attempt_at > time) return
    // Claim this retry, so a second run at the same moment does not try the card again.
    const claimed = db.run(
      'UPDATE studio_plans SET next_attempt_at=? WHERE organisation_id=? AND next_attempt_at=?',
      nextRetry(row.overdue_since!, time, RETRY_DAYS),
      org.id,
      row.next_attempt_at,
    ).changes
    const bill = openMonth(org.id)
    if (Number(claimed) === 1 && bill) await charge(bill.id, null)
  }

  /** Asks again, with the same key, about a charge that had no clear answer. */
  async function recheck(bill: InvoiceRow) {
    const claimed = db.run(
      "UPDATE studio_invoices SET charged_at=? WHERE id=? AND status='charging' AND charged_at=?",
      now(),
      bill.id,
      bill.charged_at,
    ).changes
    const row = plan(bill.organisation_id)
    if (Number(claimed) === 1 && row?.card_method_ref && bill.attempt_key)
      await ask(bill.attempt_key, bill, row, null)
  }

  /** A bill made after the backup, put back from what its charge carries; null when it cannot be. */
  function rebuild(org: Org, charge: ChargeRecord) {
    const mark = charge.marks
    const start = Number(mark.start),
      end = Number(mark.end),
      subtotal = Number(mark.subtotal)
    if (!mark.bill || !mark.number || !start || !end || !Number.isInteger(subtotal)) return null
    const kind = mark.kind === 'plus' || mark.kind === 'phone' ? mark.kind : 'month'
    const extras = { plus: mark.plus === '1', phone: mark.phone === '1' }
    if (kind === 'month') {
      const same = db.get<InvoiceRow>(
        "SELECT * FROM studio_invoices WHERE organisation_id=? AND kind='month' AND period_start=? AND status<>'void'",
        org.id,
        start,
      )
      if (same) return same
    }
    // Its own lines when they still add up to what was taken; otherwise one line for the lot.
    const fresh =
      kind === 'month'
        ? monthBill(regionOf(org), locationsOf(org), extras.plus, peopleOf(org), extras.phone)
        : null
    const bill =
      fresh?.totalMinor === charge.amountMinor
        ? fresh
        : taxed(regionOf(org), [
            {
              text: `${kind === 'month' ? 'SALEANE' : ADD_ON_NAMES[kind]}, as charged`,
              quantity: 1,
              unitMinor: subtotal,
              amountMinor: subtotal,
            },
          ])
    const taken = !!db.get('SELECT 1 FROM studio_invoices WHERE number=?', mark.number)
    return addInvoice(org, kind, start, end, extras, bill, {
      id: mark.bill,
      number: taken ? nextNumber() : mark.number,
      createdAt: Number(mark.made) || now(),
    })
  }

  /**
   * After a restore, asks the card service what it took for this studio, so nothing is charged
   * twice: a bill it took is marked paid (one made after the backup is put back from what its
   * charge carries), a bill it did not take is owed again, and the plan then carries on by itself.
   * While a charge is still being worked on, or the card service cannot be asked, the plan stays
   * held and is asked about again on the next run. False when the card service could not be asked.
   */
  async function reconcile(row: PlanRow) {
    const org = ctx.systemOrg(row.organisation_id)
    if (!org) return true
    const found = await provider.charges({ key: 'studio', value: org.id })
    if (!found) return false
    const billOf = (charge: ChargeRecord) =>
      charge.marks.bill ?? charge.attemptId.slice(0, charge.attemptId.lastIndexOf('.'))
    const tries = (charge: ChargeRecord) =>
      Number(charge.attemptId.slice(charge.attemptId.lastIndexOf('.') + 1)) || 0
    db.transaction(() => {
      if (!plan(org.id)?.held_at) return
      const settled = (charge: ChargeRecord) => invoice(billOf(charge))?.status === 'paid'
      // Something still being worked on, or taken with nothing to rebuild its bill from, waits.
      if (found.some((c) => c.status === 'processing' && !settled(c))) return
      const taken = found
        .filter((c) => c.status === 'succeeded' && !settled(c))
        .sort(
          (a, b) =>
            Number(a.marks.start) - Number(b.marks.start) ||
            Number(isAddOn(a.marks.kind)) - Number(isAddOn(b.marks.kind)),
        )
      if (taken.some((c) => !invoice(billOf(c)) && !c.marks.number)) {
        console.error(
          `[SALEANE] A payment for studio ${org.id} has no bill to match; it stays held to be checked by hand.`,
        )
        return
      }
      for (const charge of taken) {
        const bill = invoice(billOf(charge)) ?? rebuild(org, charge)
        if (!bill || bill.status === 'paid') continue
        db.run(
          "UPDATE studio_invoices SET status='charging',attempt_key=?,attempts=MAX(attempts,?) WHERE id=?",
          charge.attemptId,
          tries(charge),
          bill.id,
        )
        if (bill.kind === 'month' && Number(charge.marks.anchor))
          db.run(
            'UPDATE studio_plans SET anchor_day=? WHERE organisation_id=?',
            Number(charge.marks.anchor),
            org.id,
          )
        // Its receipt went out when it was taken, so none is sent again.
        record(charge.attemptId, { status: 'succeeded', providerRef: charge.providerRef }, null)
      }
      const after = plan(org.id)!
      for (const bill of db.all<InvoiceRow>(
        "SELECT * FROM studio_invoices WHERE organisation_id=? AND status='unknown'",
        org.id,
      )) {
        // The next try uses a key no attempt since the backup has used.
        const attempts = Math.max(
          bill.attempts,
          ...found.filter((c) => billOf(c) === bill.id).map(tries),
        )
        const later =
          bill.kind === 'month' &&
          !!db.get(
            "SELECT 1 FROM studio_invoices WHERE organisation_id=? AND kind='month' AND status='paid' AND period_start>?",
            org.id,
            bill.period_start,
          )
        if (bill.kind !== 'month' || later || after.status === 'stopped')
          db.run(
            "UPDATE studio_invoices SET status='void',attempts=?,detail=?,closed_at=? WHERE id=?",
            attempts,
            later
              ? 'Not charged: a later month was paid.'
              : 'Not charged: checked with the card service after a restore.',
            now(),
            bill.id,
          )
        else
          db.run(
            "UPDATE studio_invoices SET status='open',attempts=?,detail=? WHERE id=?",
            attempts,
            'Not taken: checked with the card service after a restore.',
            bill.id,
          )
      }
      db.run(
        'UPDATE studio_plans SET held_at=NULL,updated_at=? WHERE organisation_id=?',
        now(),
        org.id,
      )
      ctx.audit(org, null, 'billing.checked', org.id)
    })
    return true
  }

  /** Everything that is due: trials ending, months renewing, retries, grace ending, rechecks. */
  async function run() {
    if (running) return
    running = true
    try {
      const time = now()
      const each = async (rows: PlanRow[], step: (row: PlanRow) => unknown) => {
        for (const row of rows)
          try {
            await step(row)
          } catch (error) {
            console.error('[SALEANE] A studio plan could not be brought up to date.', error)
          }
      }
      // After a restore, nothing is charged by itself until the card service has said what it took.
      let unasked = 0
      for (const row of db.all<PlanRow>('SELECT * FROM studio_plans WHERE held_at IS NOT NULL'))
        try {
          if (!(await reconcile(row))) unasked++
        } catch (error) {
          console.error('[SALEANE] A restored studio plan could not be checked.', error)
        }
      if (unasked)
        console.error(
          `[SALEANE] The card service could not be asked what it took for ${unasked} restored studio plans; asking again on the next run.`,
        )
      // Real studios made before plans existed start their trial now.
      for (const { id } of db.all<{ id: string }>(
        "SELECT id FROM organisations WHERE json_extract(state,'$.operations.mode')='local' AND id NOT IN (SELECT organisation_id FROM studio_plans)",
      )) {
        const org = ctx.systemOrg(id)
        if (org) planFor(org)
      }
      await each(
        db.all<PlanRow>(
          "SELECT * FROM studio_plans WHERE status='trial' AND trial_warned_at IS NULL AND trial_ends_at<=? AND held_at IS NULL",
          time + 3 * DAY_MS,
        ),
        warnTrial,
      )
      await each(
        db.all<PlanRow>(
          "SELECT * FROM studio_plans WHERE status='trial' AND trial_ends_at<=? AND held_at IS NULL",
          time,
        ),
        endTrial,
      )
      await each(
        db.all<PlanRow>(
          "SELECT * FROM studio_plans WHERE status='active' AND period_end<=? AND held_at IS NULL",
          time,
        ),
        renew,
      )
      await each(
        db.all<PlanRow>("SELECT * FROM studio_plans WHERE status='overdue' AND held_at IS NULL"),
        chase,
      )
      await each(
        db.all<PlanRow>(
          "SELECT * FROM studio_plans WHERE status='stopped' AND locked_at IS NULL AND lock_at<=? AND held_at IS NULL",
          time,
        ),
        lock,
      )
      for (const bill of db.all<InvoiceRow>(
        "SELECT * FROM studio_invoices WHERE status='charging' AND charged_at<=?",
        time - RECHECK_MS,
      ))
        try {
          await recheck(bill)
        } catch (error) {
          console.error('[SALEANE] A SALEANE payment could not be checked.', error)
        }
    } finally {
      running = false
    }
  }

  /** A card the owner saved on the card page. Paying straight after, when the studio owes. */
  async function saveCard(setupId: string, card: PaymentEvent['card']) {
    const setup = db.transaction(() => {
      const row = db.get<SetupRow>('SELECT * FROM billing_setups WHERE id=?', setupId)
      if (!row || row.status !== 'started') return null
      const org = ctx.systemOrg(row.organisation_id)
      if (!org) return null
      if (!card) {
        db.run(
          "UPDATE billing_setups SET status='failed',detail=?,finished_at=? WHERE id=?",
          'The card could not be read.',
          now(),
          setupId,
        )
        return null
      }
      db.run("UPDATE billing_setups SET status='saved',finished_at=? WHERE id=?", now(), setupId)
      db.run(
        `UPDATE studio_plans SET card_customer_ref=?,card_method_ref=?,card_brand=?,card_last4=?,
           card_exp_month=?,card_exp_year=?,updated_at=? WHERE organisation_id=?`,
        card.customerRef,
        card.methodRef,
        card.brand,
        card.last4,
        card.expMonth,
        card.expYear,
        now(),
        org.id,
      )
      ctx.audit(org, row.account_id, 'billing.card', org.id, undefined, {
        fields: [{ f: 'card', to: `${card.brand} ending ${card.last4}` }],
      })
      return { ...row, org }
    })
    // After a restore the card is kept, and paying waits until the payments have been checked.
    if (!setup?.then_pay || plan(setup.org.id)?.held_at) return null
    return pay(setup.org, setup.account_id)
  }

  /** Pays what is owed now: the open bill, or a fresh month for a studio that has stopped. */
  async function pay(org: Org, actorId: string): Promise<InvoiceStatus> {
    const bill = db.transaction(() => {
      const row = planFor(org)!
      if (row.held_at) fail(409, RESTORED)
      if (waiting(org.id))
        fail(409, 'A payment is still being checked. Nothing more is taken until it is.')
      if (!row.card_method_ref) fail(409, 'Add a card first.')
      if (row.status === 'overdue') {
        const open = openMonth(org.id)
        if (!open) fail(409, 'There is nothing to pay.')
        return open!
      }
      if (row.status !== 'stopped') fail(409, 'There is nothing to pay now.')
      // A fresh month from today, so the days spent read only are never billed.
      const start = now()
      return addInvoice(
        org,
        'month',
        start,
        monthAfter(start, anchorOf(start)),
        chosen(row),
        nextBill(org, row),
      )
    })
    if (plan(org.id)!.status === 'stopped')
      db.run(
        'UPDATE studio_plans SET anchor_day=? WHERE organisation_id=?',
        anchorOf(bill.period_start),
        org.id,
      )
    return charge(bill.id, actorId)
  }

  /**
   * An add-on on or off. On during a paid month charges the part left; off lasts until the month
   * ends. Plus gives more AI; the phone receptionist answers the calls the desk misses.
   */
  async function setAddOn(org: Org, actorId: string, addOn: AddOn, on: boolean) {
    const row = planFor(org)!
    const name = addOn === 'plus' ? 'Plus' : 'the phone receptionist'
    const has = addOn === 'plus' ? row.plus : row.phone
    const wanted = addOn === 'plus' ? row.plus_next : row.phone_next
    const changed = (from: boolean, to: boolean) =>
      ctx.audit(org, actorId, `billing.${addOn}`, org.id, undefined, {
        fields: [{ f: addOn, from, to }],
      })
    // Nothing is sold that cannot work yet: turning it off is always allowed.
    if (on && addOn === 'phone' && !phoneConnected())
      fail(409, 'Phone calls are not connected yet, so the phone receptionist cannot be added.')
    if (!on || row.status === 'trial' || has) {
      if (on && !['trial', 'active'].includes(row.status))
        fail(409, `Pay the open bill before adding ${name}.`)
      db.transaction(() => {
        db.run(
          `UPDATE studio_plans SET ${addOn}_next=?,updated_at=? WHERE organisation_id=?`,
          on ? 1 : 0,
          now(),
          org.id,
        )
        changed(!!wanted, on)
      })
      return 'saved' as const
    }
    if (row.status !== 'active') fail(409, `Pay the open bill before adding ${name}.`)
    if (!row.card_method_ref) fail(409, 'Add a card first.')
    if (row.held_at) fail(409, RESTORED)
    const time = now()
    const part = addOnBill(
      addOn,
      regionOf(org),
      locationsOf(org),
      time,
      row.period_start!,
      row.period_end!,
    )
    if (part.totalMinor < SMALLEST_CHARGE_MINOR) {
      db.transaction(() => {
        turnOn(addOn, org.id, time)
        changed(false, true)
      })
      return 'saved' as const
    }
    const bill = db.transaction(() => {
      if (waiting(org.id))
        fail(409, 'A payment is still being checked. Nothing more is taken until it is.')
      changed(false, true)
      return addInvoice(
        org,
        addOn,
        time,
        row.period_end!,
        { plus: addOn === 'plus', phone: addOn === 'phone' },
        part,
      )
    })
    const status = await charge(bill.id, actorId)
    if (status === 'void')
      fail(402, `The card was declined, so ${name} was not added. Nothing was taken.`)
    return status
  }

  const viewOf = (bill: InvoiceRow): InvoiceView => ({
    id: bill.id,
    number: bill.number,
    kind: bill.kind,
    periodStart: bill.period_start,
    periodEnd: bill.period_end,
    currency: bill.currency,
    lines: JSON.parse(bill.lines),
    subtotalMinor: bill.subtotal_minor,
    taxMinor: bill.tax_minor,
    taxLabel: bill.tax_label,
    totalMinor: bill.total_minor,
    status: bill.status,
    test: !!bill.test,
    detail: bill.detail,
    createdAt: bill.created_at,
    paidAt: bill.paid_at,
  })

  /** One page of a studio's bills, newest first, and where the next page starts. */
  function page(orgId: string, before?: string) {
    const [at, seq] = (before ?? '').split('.').map(Number)
    const rows = db.all<InvoiceRow & { seq: number }>(
      `SELECT rowid AS seq,* FROM studio_invoices WHERE organisation_id=?
         ${before ? 'AND (created_at<? OR (created_at=? AND rowid<?))' : ''}
       ORDER BY created_at DESC,rowid DESC LIMIT ?`,
      orgId,
      ...(before ? [at, at, seq] : []),
      BILLS_PAGE + 1,
    )
    const shown = rows.slice(0, BILLS_PAGE)
    const last = shown.at(-1)
    return {
      invoices: shown.map(viewOf),
      next: rows.length > BILLS_PAGE && last ? `${last.created_at}.${last.seq}` : null,
    }
  }

  function view(org: Org): BillingView {
    const row = planFor(org)!
    const region = regionOf(org)
    const locations = locationsOf(org)
    const people = peopleOf(org)
    const time = now()
    const bills = page(org.id)
    // The month that is owed, including while a try at it is still being checked.
    const open = db.get<InvoiceRow>(
      "SELECT * FROM studio_invoices WHERE organisation_id=? AND kind='month' AND status IN ('open','charging','unknown') ORDER BY created_at DESC",
      org.id,
    )
    const coming = monthBill(region, locations, !!row.plus_next, people, !!row.phone_next)
    const ai = allowance(org).monthly
    const used = usedEach(allowance(org), storedUsage(ctx, org.id), new Date(time).toISOString())
    return {
      status: row.status,
      stopReason: row.stop_reason,
      region,
      test,
      trialEndsAt: row.trial_ends_at,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      plus: !!row.plus && row.status !== 'trial',
      plusNext: !!row.plus_next,
      phone: !!row.phone && row.status !== 'trial',
      phoneNext: !!row.phone_next,
      phoneConnected: phoneConnected(),
      cancelAtPeriodEnd: !!row.cancel_at_period_end,
      card: row.card_last4
        ? {
            brand: row.card_brand ?? 'Card',
            last4: row.card_last4,
            expMonth: row.card_exp_month ?? 0,
            expYear: row.card_exp_year ?? 0,
          }
        : null,
      locations,
      people,
      nextBill:
        row.status === 'trial'
          ? row.cancel_at_period_end
            ? null
            : { at: row.trial_ends_at, bill: coming }
          : row.status === 'active'
            ? row.cancel_at_period_end
              ? null
              : { at: row.period_end!, bill: coming }
            : row.status === 'overdue' && open
              ? { at: row.next_attempt_at ?? time, bill: viewOf(open) }
              : row.status === 'stopped'
                ? { at: time, bill: coming }
                : null,
      overdue:
        row.status === 'overdue'
          ? {
              since: row.overdue_since!,
              graceEndsAt: row.overdue_since! + GRACE_DAYS * DAY_MS,
              nextAttemptAt: row.next_attempt_at,
            }
          : null,
      checking: waiting(org.id),
      held: !!row.held_at,
      lockAt: row.status === 'stopped' ? row.lock_at : null,
      locked: !!row.locked_at,
      invoices: bills.invoices,
      moreBills: bills.next,
      ai: {
        typed: { used: used.typed, of: ai.typed },
        guestChats: { used: used.guestChats, of: ai.guestChats },
        talkSeconds: { used: used.talkSeconds, of: ai.talkSeconds },
        phoneSeconds: { used: used.phoneSeconds, of: ai.phoneSeconds },
      },
    }
  }

  return {
    provider,
    planFor,
    allowance,
    marketingEmails,
    run,
    start(intervalMs: number) {
      timer = setInterval(() => void run(), intervalMs)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
    },
    /** What the studio record carries: read only for everyone, and the dates for the owner. */
    summary(org: Org): BillingSummary | null {
      const row = planFor(org)
      if (!row) return null
      const readOnly = row.status === 'stopped'
      // Everyone hears when a read-only studio will lock, since it shuts the team out.
      const lock = readOnly ? { locked: !!row.locked_at, lockAt: row.lock_at } : {}
      if (org.role !== 'owner') return { readOnly, ...lock }
      return {
        readOnly,
        ...lock,
        status: row.status,
        stopReason: row.stop_reason,
        trialEndsAt: row.trial_ends_at,
        ...(row.overdue_since
          ? {
              graceEndsAt: row.overdue_since + GRACE_DAYS * DAY_MS,
              nextAttemptAt: row.next_attempt_at,
            }
          : {}),
        hasCard: !!row.card_method_ref,
      }
    },
    /** Whether a studio is locked: only its owner can open it, and online booking is closed. */
    locked: (orgId: string) => !!plan(orgId)?.locked_at,
    /** Whether a studio is read only (or locked) until its SALEANE bill is paid. */
    readOnly: (orgId: string) => plan(orgId)?.status === 'stopped',
    /**
     * Refuses a change to a read-only studio, after the usual sign-in and access checks. A locked
     * studio is refused to everyone but the owner, even to read; the owner can still open the
     * studio's record, pay, download its records and close doors for safety.
     */
    guard(route: Route) {
      const { request, method, path, body } = route
      if (path[1] !== 'workspaces' || !path[2]) return
      const row = plan(path[2])
      if (row?.status !== 'stopped') return
      if (row.locked_at) {
        const org = ctx.orgFor(path[2], ctx.actorFor(request, method !== 'GET'), { area: true })
        if (org.role !== 'owner') fail(402, lockedMessage(org.role))
        if (path.length === 3 || stillAllowed(path, body)) return
        fail(402, lockedMessage(org.role))
      }
      if (method === 'GET' || path.length < 4 || stillAllowed(path, body)) return
      const org = ctx.orgFor(path[2], ctx.actorFor(request, true), { area: true })
      fail(402, readOnlyMessage(org.role))
    },
    /** Card service events: a card saved on its page, or the outcome of a charge. */
    async apply(event: PaymentEvent) {
      if (db.get('SELECT 1 FROM billing_setups WHERE id=?', event.attemptId)) {
        if (event.status === 'succeeded') await saveCard(event.attemptId, event.card)
        else
          db.run(
            "UPDATE billing_setups SET status='failed',detail=?,finished_at=? WHERE id=? AND status='started'",
            event.detail ?? 'The card was not saved.',
            now(),
            event.attemptId,
          )
        return
      }
      if (event.status === 'succeeded')
        settle(event.attemptId, { status: 'succeeded', providerRef: event.providerRef }, null)
      else
        settle(
          event.attemptId,
          { status: 'failed', detail: event.detail ?? 'The card was declined.' },
          null,
        )
    },
    async routes(_: Context, route: Route): Promise<boolean> {
      const { request, method, path, url, body, reply } = route
      // The test card page stands in for the card service's page while billing is in test mode.
      if (path[1] === 'test-billing' && path.length === 3) {
        if (provider.name !== 'test') fail(404, 'This endpoint was not found.')
        ctx.rateLimit(request, 'test-billing', 30, 5 * 60000)
        const setup = db.get<SetupRow>('SELECT * FROM billing_setups WHERE id=?', path[2])
        const org = setup && ctx.systemOrg(setup.organisation_id)
        if (!setup || !org) fail(404, 'This test card page was not found.')
        const row = plan(org!.id)!
        if (method === 'GET') {
          reply(200, {
            studio: org!.state.organisation.name,
            status: setup!.status,
            thenPay: !!setup!.then_pay,
            locale: PRICE[regionOf(org!)].locale,
            currency: PRICE[regionOf(org!)].currency,
            amountMinor: setup!.then_pay
              ? (openMonth(org!.id)?.total_minor ?? nextBill(org!, row).totalMinor)
              : 0,
          })
          return true
        }
        if (method !== 'POST') fail(405, 'Use GET or POST.')
        const data = routeInput.testCard.parse(body)
        if (setup!.status !== 'started') fail(409, 'This test card page has already finished.')
        if (now() - setup!.created_at > HOSTED_MINUTES * 60000)
          fail(410, 'This test card page has closed. Start again from Plan and billing.')
        if (data.outcome === 'cancel') {
          db.run(
            "UPDATE billing_setups SET status='left',finished_at=? WHERE id=? AND status='started'",
            now(),
            setup!.id,
          )
          reply(200, { next: `${SETTINGS}&card=left` })
          return true
        }
        const card = TEST_CARDS[data.card]
        const paid = await saveCard(setup!.id, {
          customerRef: `test_customer_${org!.id.slice(0, 24)}`,
          methodRef: `test_card_${setup!.id}`,
          brand: card.brand,
          last4: data.card,
          expMonth: 12,
          expYear: new Date(now()).getUTCFullYear() + 3,
        })
        reply(200, {
          next: `${SETTINGS}&card=saved${paid ? `&paid=${paid === 'paid' ? 'yes' : 'no'}` : ''}`,
        })
        return true
      }
      if (path[1] !== 'workspaces' || path[3] !== 'billing' || path.length > 5) return false
      const actor = ctx.actorFor(request, method !== 'GET')
      const org = ctx.orgFor(path[2], actor)
      if (org.role !== 'owner') fail(403, 'Only the owner can see and change the SALEANE plan.')
      if (!real(org)) fail(409, 'Sample studios are never charged.')
      if (path.length === 4) {
        if (method !== 'GET') fail(405, 'Use GET.')
        reply(200, view(org))
        return true
      }
      // Older bills, a page at a time: every bill stays here for as long as the studio does.
      if (path[4] === 'bills') {
        if (method !== 'GET') fail(405, 'Use GET.')
        const { before } = routeInput.bills.parse(Object.fromEntries(url.searchParams))
        reply(200, page(org.id, before))
        return true
      }
      if (method !== 'POST') fail(405, 'Use POST.')
      ctx.rateLimit(request, 'billing', 20, 60000)
      const action = path[4]
      if (action === 'card') {
        routeInput.empty.parse(body)
        const row = planFor(org)!
        const id = randomUUID()
        db.run(
          "INSERT INTO billing_setups(id,organisation_id,account_id,status,then_pay,created_at) VALUES(?,?,?,'started',?,?)",
          id,
          org.id,
          actor.id,
          ['overdue', 'stopped'].includes(row.status) ? 1 : 0,
          now(),
        )
        const opened = await provider.hosted({
          attemptId: id,
          mode: 'setup',
          amountMinor: 0,
          currency: PRICE[regionOf(org)].currency,
          description: `Card for the SALEANE plan of ${org.state.organisation.name}`,
          email: actor.email,
          name: org.state.organisation.name,
          saveCard: true,
          returnUrl: `${ctx.allowedOrigin}${SETTINGS}&card=saved`,
          cancelUrl: `${ctx.allowedOrigin}${SETTINGS}&card=left`,
        })
        if (!opened.ok) {
          db.run(
            "UPDATE billing_setups SET status='failed',detail=?,finished_at=? WHERE id=?",
            opened.detail,
            now(),
            id,
          )
          fail(503, opened.detail)
        }
        if (opened.ok)
          db.run('UPDATE billing_setups SET provider_ref=? WHERE id=?', opened.providerRef, id)
        reply(200, { url: opened.ok ? opened.url : '' })
        return true
      }
      if (action === 'plus' || action === 'phone') {
        const { on } = routeInput.addOn.parse(body)
        const outcome = await setAddOn(org, actor.id, action, on)
        reply(200, { outcome, billing: view(org) })
        return true
      }
      if (action === 'pay') {
        routeInput.empty.parse(body)
        const outcome = await pay(org, actor.id)
        reply(200, { outcome, billing: view(org) })
        return true
      }
      if (action === 'stop') {
        const { stop: stopping } = routeInput.stop.parse(body)
        const row = planFor(org)!
        if (!['trial', 'active'].includes(row.status))
          fail(409, 'Only a plan in its trial or a paid month can be stopped or kept.')
        db.transaction(() => {
          db.run(
            'UPDATE studio_plans SET cancel_at_period_end=?,updated_at=? WHERE organisation_id=?',
            stopping ? 1 : 0,
            now(),
            org.id,
          )
          ctx.audit(org, actor.id, stopping ? 'billing.stop' : 'billing.keep', org.id)
        })
        reply(200, { outcome: 'saved', billing: view(org) })
        return true
      }
      fail(404, 'This endpoint was not found.')
    },
  }
}
export type Billing = ReturnType<typeof createBilling>
