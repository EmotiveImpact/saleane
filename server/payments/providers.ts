import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * PILOT-02 payment seam. One provider takes card payments for the whole server. The default is
 * test mode: guests see a clearly labelled test page, no card details are asked for and no money
 * moves. The Stripe adapter follows Stripe's published API and switches on only when every key is
 * present; it has not been run against a real account.
 *
 * Card numbers never touch SALEANE: guests type them on the provider's own page, and staff charge
 * a card the provider saved, or a card reader the provider runs.
 */
export type SavedCardDetails = {
  customerRef: string
  methodRef: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}
export type PayOutcome =
  | { status: 'succeeded'; providerRef: string; card?: SavedCardDetails }
  /** Taken by the provider but finished later (a card reader, a slow refund): wait for its event. */
  | { status: 'processing'; providerRef: string }
  | { status: 'failed'; detail: string }
  /** The request may have reached the provider. The same attempt key makes a retry safe. */
  | { status: 'unknown'; detail: string }
/** A verified provider event about one attempt. */
export type PaymentEvent = {
  attemptId: string
  providerRef: string
  status: 'succeeded' | 'failed'
  detail?: string
  card?: SavedCardDetails
}
export type HostedInput = {
  attemptId: string
  mode: 'payment' | 'setup'
  amountMinor: number
  currency: 'GBP' | 'USD'
  description: string
  email: string
  name: string
  saveCard: boolean
  returnUrl: string
  cancelUrl: string
}
export type PaymentProvider = {
  name: 'test' | 'stripe'
  live: boolean
  /** Card readers staff can choose at checkout. */
  readers: { id: string; label: string }[]
  hosted: (
    input: HostedInput,
  ) => Promise<{ ok: true; url: string; providerRef: string } | { ok: false; detail: string }>
  chargeSaved: (input: {
    attemptId: string
    amountMinor: number
    currency: 'GBP' | 'USD'
    description: string
    card: Pick<SavedCardDetails, 'customerRef' | 'methodRef' | 'last4'>
  }) => Promise<PayOutcome>
  reader: (input: {
    attemptId: string
    amountMinor: number
    currency: 'GBP' | 'USD'
    description: string
    readerId: string
  }) => Promise<PayOutcome>
  refund: (input: {
    attemptId: string
    paymentRef: string
    amountMinor: number
  }) => Promise<PayOutcome>
  /** Detaches a saved card from the provider's customer, so it can never be charged again. */
  removeCard: (methodRef: string) => Promise<boolean>
  /** Closes a guest's unpaid payment page. False when it can no longer be closed (it was paid). */
  closeHosted: (providerRef: string) => Promise<boolean>
  /** Verifies a webhook and reads its events; null when it is not genuine. */
  events: (request: {
    headers: Record<string, string | undefined>
    body: string
  }) => Promise<PaymentEvent[] | null>
}

/** Test cards for the test page. The second always declines, so staff can rehearse a refusal. */
export const TEST_CARDS = {
  '4242': { brand: 'Visa', declines: false },
  '0002': { brand: 'Visa', declines: true },
} as const

export function testPaymentProvider(origin: string): PaymentProvider {
  let n = 0
  const ref = (kind: string) => `test_${kind}_${Date.now().toString(36)}${(++n).toString(36)}`
  return {
    name: 'test',
    live: false,
    readers: [{ id: 'test-reader', label: 'Test card reader' }],
    async hosted(input) {
      return {
        ok: true,
        url: `${origin}/pay/test#${input.attemptId}`,
        providerRef: ref(input.mode === 'setup' ? 'setup' : 'checkout'),
      }
    },
    async chargeSaved(input) {
      if (TEST_CARDS[input.card.last4 as keyof typeof TEST_CARDS]?.declines)
        return { status: 'failed', detail: 'The card was declined (test card ending 0002).' }
      return { status: 'succeeded', providerRef: ref('pi') }
    },
    // A test reader waits for someone to tap "approve" or "decline" on the checkout screen.
    async reader() {
      return { status: 'processing', providerRef: ref('reader') }
    },
    async refund() {
      return { status: 'succeeded', providerRef: ref('re') }
    },
    async removeCard() {
      return true
    },
    async closeHosted() {
      return true
    },
    // Test events come from SALEANE's own test page, never from a webhook.
    async events() {
      return null
    },
  }
}

type Fetch = typeof fetch
const TIMEOUT_MS = 20000
/** How long a guest's payment page stays open. */
export const HOSTED_MINUTES = 30

/** Stripe: Checkout for guests, saved cards off-session, server-driven Terminal readers, refunds. */
export function stripeProvider(config: {
  secretKey: string
  webhookSecret: string
  readers?: { id: string; label: string }[]
  fetcher?: Fetch
  now?: () => number
}): PaymentProvider {
  const fetcher = config.fetcher ?? fetch
  const now = config.now ?? Date.now
  async function call(
    path: string,
    form: Record<string, string> | null,
    idempotencyKey?: string,
  ): Promise<
    { status: number; json: Record<string, unknown> } | { error: 'unknown' | 'unreached' }
  > {
    try {
      const response = await fetcher(`https://api.stripe.com/v1/${path}`, {
        method: form ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      let json: Record<string, unknown> = {}
      try {
        json = (await response.json()) as Record<string, unknown>
      } catch {
        /* No body. */
      }
      return { status: response.status, json }
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code
      return {
        error: code && ['ENOTFOUND', 'ECONNREFUSED'].includes(code) ? 'unreached' : 'unknown',
      }
    }
  }
  const message = (json: Record<string, unknown>, fallback: string) =>
    String((json.error as { message?: string } | undefined)?.message ?? fallback)
  const outcome = (
    result: Awaited<ReturnType<typeof call>>,
    read: (json: Record<string, unknown>) => PayOutcome,
  ): PayOutcome => {
    if ('error' in result)
      return result.error === 'unreached'
        ? {
            status: 'failed',
            detail: 'The payment provider could not be reached. Nothing was charged.',
          }
        : { status: 'unknown', detail: 'The connection dropped before the provider answered.' }
    if (result.status >= 200 && result.status < 300) return read(result.json)
    // A server error or a clash with a request still running may follow a completed charge;
    // only the same idempotency key can safely find out.
    const kind = (result.json.error as { type?: string } | undefined)?.type
    if (result.status >= 500 || result.status === 409 || kind === 'idempotency_error')
      return {
        status: 'unknown',
        detail:
          'The payment provider did not give a clear answer. Check again before trying anything else.',
      }
    return {
      status: 'failed',
      detail: message(result.json, `Refused by the provider (${result.status}).`),
    }
  }
  const intentOutcome = (json: Record<string, unknown>): PayOutcome => {
    const id = String(json.id ?? '')
    if (json.status === 'succeeded') return { status: 'succeeded', providerRef: id }
    if (json.status === 'processing' || json.status === 'requires_capture')
      return { status: 'processing', providerRef: id }
    return {
      status: 'failed',
      detail: message(
        { error: json.last_payment_error },
        'The card needs the client to confirm it.',
      ),
    }
  }
  async function cardDetails(
    methodRef: string,
    customerRef: string,
  ): Promise<SavedCardDetails | undefined> {
    const result = await call(`payment_methods/${encodeURIComponent(methodRef)}`, null)
    if ('error' in result || result.status !== 200) return undefined
    const card = result.json.card as
      { brand?: string; last4?: string; exp_month?: number; exp_year?: number } | undefined
    if (!card?.last4) return undefined
    return {
      customerRef,
      methodRef,
      brand: card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : 'Card',
      last4: card.last4,
      expMonth: Number(card.exp_month ?? 0),
      expYear: Number(card.exp_year ?? 0),
    }
  }
  return {
    name: 'stripe',
    live: !config.secretKey.startsWith('sk_test_'),
    readers: config.readers ?? [],
    async hosted(input) {
      const currency = input.currency.toLowerCase()
      let customer = ''
      if (input.mode === 'setup' || input.saveCard) {
        const created = await call(
          'customers',
          { email: input.email, name: input.name, 'metadata[attempt]': input.attemptId },
          `${input.attemptId}:customer`,
        )
        if ('error' in created || created.status !== 200)
          return { ok: false, detail: 'The payment page could not be opened. Try again.' }
        customer = String(created.json.id)
      }
      const form: Record<string, string> = {
        mode: input.mode,
        success_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        'metadata[attempt]': input.attemptId,
        // Stripe's shortest life for a payment page; an unpaid page closes on its own after it.
        expires_at: String(Math.floor(now() / 1000) + HOSTED_MINUTES * 60),
        ...(customer ? { customer } : { customer_email: input.email }),
      }
      if (input.mode === 'payment') {
        Object.assign(form, {
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': currency,
          'line_items[0][price_data][unit_amount]': String(input.amountMinor),
          'line_items[0][price_data][product_data][name]': input.description,
          'payment_intent_data[metadata][attempt]': input.attemptId,
          ...(input.saveCard ? { 'payment_intent_data[setup_future_usage]': 'off_session' } : {}),
        })
      } else {
        Object.assign(form, {
          currency,
          'payment_method_types[0]': 'card',
          'setup_intent_data[metadata][attempt]': input.attemptId,
        })
      }
      const result = await call('checkout/sessions', form, input.attemptId)
      if ('error' in result || result.status !== 200 || typeof result.json.url !== 'string')
        return { ok: false, detail: 'The payment page could not be opened. Try again.' }
      return { ok: true, url: result.json.url, providerRef: String(result.json.id) }
    },
    async chargeSaved(input) {
      const result = await call(
        'payment_intents',
        {
          amount: String(input.amountMinor),
          currency: input.currency.toLowerCase(),
          customer: input.card.customerRef,
          payment_method: input.card.methodRef,
          off_session: 'true',
          confirm: 'true',
          description: input.description,
          'metadata[attempt]': input.attemptId,
        },
        input.attemptId,
      )
      return outcome(result, intentOutcome)
    },
    async reader(input) {
      const intent = await call(
        'payment_intents',
        {
          amount: String(input.amountMinor),
          currency: input.currency.toLowerCase(),
          'payment_method_types[0]': 'card_present',
          capture_method: 'automatic',
          description: input.description,
          'metadata[attempt]': input.attemptId,
        },
        input.attemptId,
      )
      if ('error' in intent || intent.status !== 200) return outcome(intent, intentOutcome)
      const id = String(intent.json.id)
      const sent = await call(
        `terminal/readers/${encodeURIComponent(input.readerId)}/process_payment_intent`,
        { payment_intent: id },
        `${input.attemptId}:reader`,
      )
      return outcome(sent, () => ({ status: 'processing', providerRef: id }))
    },
    async refund(input) {
      const result = await call(
        'refunds',
        {
          payment_intent: input.paymentRef,
          amount: String(input.amountMinor),
          'metadata[attempt]': input.attemptId,
        },
        input.attemptId,
      )
      return outcome(result, (json) =>
        json.status === 'succeeded'
          ? { status: 'succeeded', providerRef: String(json.id) }
          : json.status === 'pending'
            ? { status: 'processing', providerRef: String(json.id) }
            : { status: 'failed', detail: 'The provider could not refund this payment.' },
      )
    },
    async closeHosted(providerRef) {
      const result = await call(`checkout/sessions/${encodeURIComponent(providerRef)}/expire`, {})
      return !('error' in result) && result.status === 200
    },
    async removeCard(methodRef) {
      const result = await call(`payment_methods/${encodeURIComponent(methodRef)}/detach`, {})
      return !('error' in result) && result.status === 200
    },
    async events(request) {
      const header = request.headers['stripe-signature'] ?? ''
      const parts = Object.fromEntries(
        header.split(',').map((part) => part.split('=', 2) as [string, string]),
      )
      const signed = Number(parts.t)
      if (!signed || Math.abs(now() / 1000 - signed) > 300) return null
      const expected = createHmac('sha256', config.webhookSecret)
        .update(`${parts.t}.${request.body}`, 'utf8')
        .digest('hex')
      const supplied = header
        .split(',')
        .filter((part) => part.startsWith('v1='))
        .map((part) => part.slice(3))
      if (
        !supplied.some(
          (value) =>
            value.length === expected.length &&
            timingSafeEqual(Buffer.from(value), Buffer.from(expected)),
        )
      )
        return null
      let event: { type?: string; data?: { object?: Record<string, unknown> } }
      try {
        event = JSON.parse(request.body)
      } catch {
        return null
      }
      const object = event.data?.object ?? {}
      const attemptId = String((object.metadata as { attempt?: string } | undefined)?.attempt ?? '')
      if (!attemptId) return []
      const id = String(object.id ?? '')
      const saved = async () =>
        object.customer && object.payment_method
          ? cardDetails(String(object.payment_method), String(object.customer))
          : undefined
      switch (event.type) {
        case 'payment_intent.succeeded':
          return [
            {
              attemptId,
              providerRef: id,
              status: 'succeeded',
              card: object.setup_future_usage ? await saved() : undefined,
            },
          ]
        case 'setup_intent.succeeded':
          return [{ attemptId, providerRef: id, status: 'succeeded', card: await saved() }]
        case 'payment_intent.payment_failed':
        case 'setup_intent.setup_failed':
          return [
            {
              attemptId,
              providerRef: id,
              status: 'failed',
              detail: message(
                { error: object.last_payment_error ?? object.last_setup_error },
                'The card was declined.',
              ),
            },
          ]
        case 'checkout.session.expired':
          return [
            {
              attemptId,
              providerRef: id,
              status: 'failed',
              detail: 'The payment page closed unpaid.',
            },
          ]
        case 'refund.updated':
          return object.status === 'succeeded'
            ? [{ attemptId, providerRef: id, status: 'succeeded' }]
            : object.status === 'failed'
              ? [{ attemptId, providerRef: id, status: 'failed', detail: 'The refund failed.' }]
              : []
        default:
          return []
      }
    },
  }
}

/** Reads the payment provider from the environment. Unset means test mode. */
export function paymentProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  origin = 'http://127.0.0.1:5173',
  fetcher?: Fetch,
): PaymentProvider {
  const name = env.SALEANE_PAYMENTS_PROVIDER?.trim() || 'test'
  if (name === 'test') return testPaymentProvider(origin.replace(/\/$/, ''))
  if (name !== 'stripe') throw new Error(`Unknown payment provider "${name}".`)
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].filter((key) => !env[key]?.trim())
  if (missing.length) throw new Error(`Set ${missing.join(' and ')} to take card payments.`)
  const readers = (env.STRIPE_READERS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...label] = entry.split(':')
      return { id, label: label.join(':') || 'Card reader' }
    })
  return stripeProvider({
    secretKey: env.STRIPE_SECRET_KEY!.trim(),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET!.trim(),
    readers,
    fetcher,
  })
}
