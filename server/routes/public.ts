import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { digest, token } from '../auth'
import { canonical, fail } from '../http'
import { commandSchema, dispatch, slots } from '../../src/domain/commands'
import { businessDate, hoursFor, operations } from '../../src/domain/operations'
import { addDays } from '../../src/domain/format'
import type { BusinessState } from '../../src/domain/model'
import {
  onlinePatchTestStop,
  patchTestBooking,
  patchTestSettings,
} from '../../src/domain/patchTests'
import { currentWording } from '../../src/domain/consent'
import { HOLD_LIMITS, holdInput, guestContact } from '../context'
import type { Context, Org, Route, HoldAllocation, HoldRow } from '../context'
import { issueGuestLink } from './guest'
import { bookingChannel } from '../../src/domain/bookingChannel'
import {
  offeredAt,
  places,
  resourceLocation,
  serviceAt,
  staffLocationOn,
  staffPlaces,
} from '../../src/domain/locations'
import { isOn } from '../../src/assistant/receptionist'
import { guestPhone, phoneProblem } from '../../src/domain/phone'
import { GUEST_CANCEL_CUTOFF_HOURS } from '../../src/domain/guest'
import { BOOKING_DAYS, NEXT_FREE_DAYS, STRIP_DAYS } from '../../src/domain/bookingTerms'
import { guestPaymentFor } from '../payments/service'
import { OFFER_UNKNOWN, readOffer, spendOffer } from '../offers'
import { offerEnds, offerMatches } from '../../src/domain/quietOffers'
import { OFFER_GONE, offerTimeWords } from '../../src/domain/quietInvites'

/**
 * The open locations a guest can book at: somewhere a treatment is offered, someone who does it
 * works there, and a room or chair it needs is there. A new location still being set up stays
 * off the booking page until it can take a visit.
 */
function bookingLocations(s: BusinessState) {
  const people = s.staff.filter((person) => !person.archived)
  return places(s).filter((place) =>
    s.services.some(
      (service) =>
        !service.archived &&
        offeredAt(service, place.id) &&
        people.some(
          (person) =>
            person.serviceIds.includes(service.id) && staffPlaces(s, person.id).includes(place.id),
        ) &&
        s.resources.some(
          (resource) =>
            !resource.archived &&
            resource.type === service.resourceType &&
            resourceLocation(s, resource) === place.id,
        ),
    ),
  )
}

/** A location shut all day: closed on its weekly hours, or closed for the whole of its hours. */
function placeClosed(s: BusinessState, date: string, locationId?: string) {
  const hours = hoursFor(s, date, locationId)
  if (!hours || hours.closed) return true
  return operations(s).closures.some(
    (c) =>
      c.date === date && !c.staffId && c.startMinutes <= hours.open && c.endMinutes >= hours.close,
  )
}

/** Public booking routes. These never return clients, histories or money. Returns false when the request belongs to another module. */
export async function publicRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { db, now, rateLimit, address, visitorFor, turnstile, paymentProvider, messaging } = ctx
  const { publicOrg, persist, withHolds, chooseStaff } = ctx
  const { request, method, url, path, body, reply } = route
  if (path[1] === 'public' && path[2]) {
    const slug = path[2]
    if (path.length === 3 && method === 'GET') {
      const org = publicOrg(slug),
        state = org.state,
        sample = operations(state).mode === 'sandbox',
        tax = operations(state).tax
      reply(200, {
        // Includes the studio's phone and email for guests, when it gave them.
        organisation: state.organisation,
        // Each treatment's deposit as it will be booked, so the guest sees it before choosing.
        services: state.services.filter((service) => !service.archived),
        staff: state.staff
          .filter((person) => !person.archived)
          .map((person) => ({
            id: person.id,
            name: person.name,
            role: person.role,
            serviceIds: person.serviceIds,
            tone: person.tone,
            // V2: where they work, so a guest choosing a location sees only who is there.
            locationIds: staffPlaces(state, person.id),
          })),
        // V2: open locations for the guest to choose from, main first; only those that can take
        // a visit, so a location still being set up is never offered.
        locations: bookingLocations(state).map(
          ({ id, name, address, arrivalNote, phone, email }) => ({
            id,
            name,
            address,
            ...(arrivalNote ? { arrivalNote } : {}),
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
          }),
        ),
        today: businessDate(state, new Date(now()).toISOString()),
        sample,
        // V1.5: treatments marked as needing a patch test tell guests how far ahead to have one.
        patchTestHours: patchTestSettings(state).hoursBefore,
        // Stage 3: with the studio's rule on, a treatment that needs a patch test is not booked
        // here, and the guest is shown how to get one: the studio's patch test, when a guest can
        // book it, or its phone and email. The same for every guest; nothing about anyone.
        ...(patchTestSettings(state).stopOnline
          ? { patchTestFirst: { testServiceId: patchTestBooking(state)?.id ?? null } }
          : {}),
        // V1.5: the studio's current words for email news, so a ticked box records what was read.
        emailNews: (({ version, text }) => ({ version, text }))(currentWording(state)),
        // PILOT-02: a sample studio only simulates its deposits. A real studio's guest pays the
        // deposit by card once the visit is booked, on the provider's own page: SALEANE's
        // labelled test page while payments are in test mode, where no money moves.
        depositPolicy: sample ? 'simulated' : 'card',
        cardPayments: sample ? null : { testMode: !paymentProvider.live },
        // PILOT-01: whether emails really go out, so the page never says one was sent when not.
        emailsLive: !sample && messaging.email.live,
        // LOCAL-02: the rule the guest agrees to. Cancelling online is open until the visit
        // starts; a paid deposit is refunded until the cutoff and kept after it. The studio may
        // charge a share of the price for a late cancellation or a missed visit (PILOT-02).
        cancellation: {
          cutoffHours: GUEST_CANCEL_CUTOFF_HOURS,
          feePercent: operations(state).protection?.feePercent ?? 0,
        },
        // Only the rate and basis, so each service can show its full price including any tax.
        tax:
          tax && tax.rateBps > 0
            ? { label: tax.label, rateBps: tax.rateBps, inclusive: tax.inclusive }
            : null,
        botCheck: operations(state).botCheck && turnstile ? { siteKey: turnstile.siteKey } : null,
        // V4: whether the AI receptionist chat shows on this page.
        receptionist: isOn(state),
        // V5: the studio's colours, the same at every location.
        ...(operations(state).look ? { look: operations(state).look } : {}),
      })
      return true
    }
    if (path[3] === 'availability' && path.length === 4 && method === 'GET') {
      const query = z
        .object({
          serviceId: z.string().min(1).max(100),
          staffId: z.string().min(1).max(100),
          date: z.iso.date(),
          locationId: z.string().min(1).max(150).optional(),
        })
        .parse(Object.fromEntries(url.searchParams))
      const org = publicOrg(slug)
      reply(200, {
        times: slots(
          withHolds(org),
          query.serviceId,
          query.staffId,
          query.date,
          new Date(now()).toISOString(),
          query.locationId,
        ),
      })
      return true
    }
    // A run of days for the booking page's day strip: whether each is closed and how many times
    // are free, and the first free time from a day on. Never before the studio's today.
    if (['days', 'next'].includes(path[3]) && path.length === 4 && method === 'GET') {
      rateLimit(request, 'public-days', 60, 5 * 60000)
      const query = z
        .object({
          serviceId: z.string().min(1).max(100),
          staffId: z.string().min(1).max(100),
          from: z.iso.date(),
          locationId: z.string().min(1).max(150).optional(),
        })
        .parse(Object.fromEntries(url.searchParams))
      const org = publicOrg(slug)
      const state = withHolds(org),
        time = new Date(now()).toISOString(),
        today = businessDate(org.state, time)
      const first = query.from < today ? today : query.from
      const last = addDays(today, BOOKING_DAYS - 1)
      const day = (date: string) => {
        // A professional chosen by name is wherever they work that day.
        const place =
          query.locationId ??
          (query.staffId === 'any' ? undefined : staffLocationOn(state, query.staffId, date))
        const closed = placeClosed(state, date, place)
        const times = closed
          ? []
          : slots(state, query.serviceId, query.staffId, date, time, query.locationId)
        return { date, closed, times }
      }
      if (path[3] === 'days') {
        const days = []
        for (let date = first; date <= last && days.length < STRIP_DAYS; date = addDays(date, 1)) {
          const { closed, times } = day(date)
          days.push({ date, closed, times: times.length })
        }
        reply(200, { days })
      } else {
        let next: { date: string; startMinutes: number } | null = null
        for (let n = 0, date = first; !next && n < NEXT_FREE_DAYS && date <= last; n++) {
          const { times } = day(date)
          if (times.length) next = { date, startMinutes: times[0] }
          date = addDays(date, 1)
        }
        reply(200, { next })
      }
      return true
    }
    // Stage 5: the quiet-time price a guest's private link carries, read before they choose. The
    // same for a link that never existed, was revoked or ended, so a guess reveals nothing.
    if (path[3] === 'offer' && path.length === 4 && method === 'POST') {
      rateLimit(request, 'public-offer', 30, 5 * 60000)
      const data = z
        .object({ offer: z.string().min(1).max(200) })
        .strict()
        .parse(body)
      const org = publicOrg(slug)
      const open = readOffer(ctx, org, data.offer)
      if (!open.ok) {
        reply(200, { problem: open.problem })
        return true
      }
      const { opening, offer } = open
      reply(200, {
        offer: {
          serviceId: opening.serviceId,
          staffId: opening.staffId,
          ...(opening.locationId ? { locationId: opening.locationId } : {}),
          date: opening.date,
          startMinutes: opening.startMinutes,
          priceMinor: offer.priceMinor,
          usualPriceMinor: offer.usualPriceMinor,
          endsAt: offer.endsAt,
          ends: offerEnds(org.state, offer, open.writtenAt),
          time: offerTimeWords(org.state, opening),
        },
      })
      return true
    }
    if (path[3] === 'holds' && path[4] === 'release' && path.length === 5 && method === 'POST') {
      rateLimit(request, 'public-write', 20, 5 * 60000)
      const data = z
        .object({ hold: z.string().min(32).max(100) })
        .strict()
        .parse(body)
      const released = db.transaction(() => {
        const org = publicOrg(slug)
        return (
          db.run(
            'DELETE FROM booking_holds WHERE token_hash=? AND organisation_id=? AND appointment_id IS NULL',
            digest(data.hold),
            org.id,
          ).changes > 0
        )
      })
      reply(200, { released })
      return true
    }
    if (path[3] === 'holds' && path.length === 4 && method === 'POST') {
      const limits = HOLD_LIMITS
      rateLimit(request, 'public-write', 20, 5 * 60000)
      rateLimit(request, 'public-hold-minute', limits.HOLDS_PER_MINUTE, 60000)
      rateLimit(request, 'public-hold-hour', limits.HOLDS_PER_HOUR, 60 * 60000)
      const {
        replaces,
        botCheck,
        offer: offerToken,
        ...data
      } = holdInput
        .extend({
          replaces: z.string().min(32).max(100).optional(),
          botCheck: z.string().min(1).max(2048).optional(),
          /** Stage 5: the private link of an invitation with a quiet-time price. */
          offer: z.string().min(1).max(200).optional(),
        })
        .parse(body)
      // The check runs before any write; a studio that switched it on never takes an unchecked hold.
      if (operations(publicOrg(slug).state).botCheck && turnstile) {
        if (!botCheck || !(await turnstile.verify(botCheck, address(request))))
          fail(403, 'Complete the quick check below, then reserve your time again.')
      }
      const raw = token(),
        visitor = visitorFor(request)
      let expires = 0,
        heldWith = ''
      let heldOffer: { priceMinor: number; usualPriceMinor: number } | undefined
      let offerProblem: string | undefined
      db.transaction(() => {
        const time = now()
        const org = publicOrg(slug)
        // Stage 3: a treatment the studio keeps for guests with a patch test is never held here.
        const patchStop = onlinePatchTestStop(org.state, data.serviceId)
        if (patchStop) fail(422, patchStop)
        expires = time + limits.HOLD_MS
        db.run('DELETE FROM booking_holds WHERE expires_at<=? AND appointment_id IS NULL', time)
        if (replaces)
          db.run(
            'DELETE FROM booking_holds WHERE token_hash=? AND organisation_id=? AND appointment_id IS NULL',
            digest(replaces),
            org.id,
          )
        // One visitor keeps at most HOLDS_PER_VISITOR: the newest replace the oldest, never stack.
        // A refused new hold rolls back, so the visitor keeps the time they already had.
        for (const old of db
          .all<{ token_hash: string }>(
            'SELECT token_hash FROM booking_holds WHERE organisation_id=? AND visitor=? AND appointment_id IS NULL ORDER BY expires_at DESC, rowid DESC',
            org.id,
            visitor,
          )
          .slice(limits.HOLDS_PER_VISITOR - 1))
          db.run('DELETE FROM booking_holds WHERE token_hash=?', old.token_hash)
        const active = db.get<{ count: number }>(
          'SELECT count(*) AS count FROM booking_holds WHERE organisation_id=? AND appointment_id IS NULL',
          org.id,
        )!.count
        const professionals = org.state.staff.filter((person) => !person.archived).length
        if (
          active >=
          Math.max(limits.STUDIO_HOLDS_MIN, limits.STUDIO_HOLDS_PER_PROFESSIONAL * professionals)
        )
          fail(429, 'Many guests are choosing times right now. Try again in a few minutes.')
        const blocked = withHolds(org),
          allocation = chooseStaff(blocked, data)
        heldWith = allocation.staffId
        const service = org.state.services.find((service) => service.id === data.serviceId)!
        // V2: the price where the visit will be, which can differ between locations.
        const place = data.locationId ?? staffLocationOn(org.state, allocation.staffId, data.date)
        const usual = serviceAt(service, place).priceMinor
        // Stage 5: a quiet-time price holds only for exactly its time; otherwise the time is held
        // at the usual price and the guest is told why before they confirm.
        let offer: HoldAllocation['offer']
        heldOffer = undefined
        offerProblem = undefined
        if (offerToken) {
          const open = readOffer(ctx, org, offerToken)
          if (!open.ok) offerProblem = open.problem
          else if (
            !offerMatches(org.state, open.opening, {
              serviceId: data.serviceId,
              staffId: allocation.staffId,
              date: data.date,
              startMinutes: data.startMinutes,
              locationId: place,
            })
          )
            offerProblem = `This quiet-time price is for ${offerTimeWords(org.state, open.opening)} only.`
          else if (open.offer.usualPriceMinor !== usual) offerProblem = OFFER_UNKNOWN
          else {
            offer = {
              messageId: open.messageId,
              tokenHash: open.tokenHash,
              usualPriceMinor: usual,
            }
            heldOffer = { priceMinor: open.offer.priceMinor, usualPriceMinor: usual }
          }
        }
        const input: HoldAllocation = {
          ...data,
          ...allocation,
          duration: service.durationMinutes,
          buffer: service.bufferMinutes,
          price: heldOffer ? heldOffer.priceMinor : usual,
          deposit: service.depositMinor,
          resourceType: service.resourceType,
          tax: operations(org.state).tax ?? null,
          ...(offer ? { offer } : {}),
        }
        db.run(
          'INSERT INTO booking_holds(token_hash,id,organisation_id,input,expires_at,visitor) VALUES(?,?,?,?,?,?)',
          digest(raw),
          randomUUID(),
          org.id,
          JSON.stringify(input),
          expires,
          visitor,
        )
      })
      // Who the time is with, so a guest who chose "no preference" sees who they will meet.
      reply(201, {
        hold: raw,
        expiresAt: new Date(expires).toISOString(),
        staffId: heldWith,
        ...(heldOffer ? { offer: heldOffer } : {}),
        ...(offerProblem ? { offerProblem } : {}),
      })
      return true
    }
    if (path[3] === 'book' && path.length === 4 && method === 'POST') {
      // The deposit still to pay, read the same way as on the guest's own visit page, so the
      // page can offer to pay it straight away. Absent when there is nothing to pay.
      const depositDue = (booked: Org, appointmentId: string) => {
        const payment = guestPaymentFor(ctx, booked, appointmentId)
        return payment ? { payment } : {}
      }
      rateLimit(request, 'public-write', 20, 5 * 60000)
      const data = z
        .object({
          hold: z.string().min(32).max(100),
          contact: guestContact,
          policy: z.literal(true),
          /** The version of the email news wording shown to the guest. */
          emailNewsVersion: z.number().int().min(1).max(1000).optional(),
          // The `from` value of a shared booking link. Unknown values are ignored, not refused.
          from: z.unknown().optional(),
        })
        .strict()
        .parse(body)
      const fingerprint = digest(canonical(data.contact))
      const result = db.transaction(() => {
        const org = publicOrg(slug)
        // Guests write their number the way they know it, such as 07700 900456 in the UK; it is
        // kept as an international number. Checked first, so a slip never costs the held time.
        const region = org.state.organisation.region
        const phone = guestPhone(region, data.contact.phone)
        if (!phone) fail(422, phoneProblem(region))
        const hash = digest(data.hold)
        const hold = db.get<HoldRow>(
          'SELECT id,input,expires_at,appointment_id,fingerprint FROM booking_holds WHERE token_hash=? AND organisation_id=?',
          hash,
          org.id,
        )
        if (!hold) fail(409, 'This reservation expired. Choose a time again.')
        if (hold!.appointment_id) {
          if (hold!.fingerprint !== fingerprint)
            fail(409, 'This reservation has already been used.')
          // The first response may never have arrived, so the guest gets a fresh manage link and
          // any earlier one stops working.
          return {
            appointmentId: hold!.appointment_id,
            replayed: true,
            manage: issueGuestLink(ctx, org, hold!.appointment_id!, 'booking'),
            ...depositDue(org, hold!.appointment_id!),
          }
        }
        if (hold!.expires_at <= now()) fail(409, 'This reservation expired. Choose a time again.')
        const allocation = JSON.parse(hold!.input) as HoldAllocation
        // Stage 3: the studio may have turned its patch test rule on while the time was held.
        const patchStop = onlinePatchTestStop(org.state, allocation.serviceId)
        if (patchStop) fail(422, patchStop)
        const service = org.state.services.find((service) => service.id === allocation.serviceId)
        if (
          !service ||
          service.durationMinutes !== allocation.duration ||
          service.bufferMinutes !== allocation.buffer ||
          serviceAt(
            service,
            allocation.locationId ??
              staffLocationOn(org.state, allocation.staffId, allocation.date),
          ).priceMinor !== (allocation.offer?.usualPriceMinor ?? allocation.price) ||
          service.depositMinor !== allocation.deposit ||
          service.resourceType !== allocation.resourceType ||
          (allocation.tax !== undefined &&
            canonical(operations(org.state).tax ?? null) !== canonical(allocation.tax))
        )
          fail(
            409,
            'This service changed during the reservation. Review it and choose a time again.',
          )
        chooseStaff(withHolds(org, hash), allocation, allocation.resourceId)
        // Stage 5: a quiet-time price's link must still be unused and not revoked as it is booked.
        if (
          allocation.offer &&
          !db.get(
            'SELECT 1 FROM offer_links WHERE token_hash=? AND organisation_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?',
            allocation.offer.tokenHash,
            org.id,
            now(),
          )
        )
          fail(409, `${OFFER_GONE} You can still book this time at the usual price.`)
        const command = commandSchema.parse({
          type: 'book',
          input: {
            serviceId: allocation.serviceId,
            staffId: allocation.staffId,
            resourceId: allocation.resourceId,
            date: allocation.date,
            startMinutes: allocation.startMinutes,
            ...(allocation.locationId ? { locationId: allocation.locationId } : {}),
            contact: { ...data.contact, phone },
            source: 'online',
            channel: bookingChannel(data.from),
            ...(data.contact.marketingConsent && data.emailNewsVersion
              ? { consentVersion: data.emailNewsVersion }
              : {}),
          },
        })
        const result = dispatch(
          org.state,
          command,
          'Guest booking',
          new Date(now()).toISOString(),
          allocation.offer ? { offer: { messageId: allocation.offer.messageId } } : {},
        )
        if (!result.ok)
          fail(allocation.offer && /quiet-time price/.test(result.error) ? 409 : 422, result.error)
        // The link is used by this visit in the same transaction, so a retry never takes it twice.
        if (allocation.offer) spendOffer(ctx, org.id, allocation.offer.tokenHash, result.recordId)
        persist(org, result.state, null, 'public.book', result.recordId)
        db.run(
          'UPDATE booking_holds SET appointment_id=?,fingerprint=? WHERE token_hash=?',
          result.recordId,
          fingerprint,
          hash,
        )
        const booked = { ...org, state: result.state }
        return {
          appointmentId: result.recordId,
          manage: issueGuestLink(ctx, booked, result.recordId, 'booking'),
          sample: operations(org.state).mode === 'sandbox',
          depositPolicy: operations(org.state).mode === 'sandbox' ? 'simulated' : 'card',
          ...depositDue(booked, result.recordId),
          confirmation: 'local_only',
        }
      })
      reply(200, result)
      return true
    }
  }
  return false
}
