import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { digest, token } from '../auth'
import { canonical, fail } from '../http'
import { commandSchema, dispatch, slots } from '../../src/domain/commands'
import { businessDate, operations } from '../../src/domain/operations'
import { holdInput, guestContact } from '../context'
import type { Context, Route, HoldAllocation, HoldRow } from '../context'

/** Public booking routes. These never return clients, histories or money. Returns false when the request belongs to another module. */
export async function publicRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { db, now, rateLimit, publicOrg, persist, withHolds, chooseStaff } = ctx
  const { request, method, url, path, body, reply } = route
  if (path[1] === 'public' && path[2]) {
    const slug = path[2]
    if (path.length === 3 && method === 'GET') {
      const org = publicOrg(slug),
        state = org.state,
        sample = operations(state).mode === 'sandbox'
      reply(200, {
        organisation: state.organisation,
        services: state.services
          .filter((service) => !service.archived)
          .map((service) => ({ ...service, depositMinor: sample ? service.depositMinor : 0 })),
        staff: state.staff
          .filter((person) => !person.archived)
          .map((person) => ({
            id: person.id,
            name: person.name,
            role: person.role,
            serviceIds: person.serviceIds,
            tone: person.tone,
          })),
        today: businessDate(state, new Date(now()).toISOString()),
        sample,
        depositPolicy: sample ? 'simulated' : 'pay_at_studio',
        paymentCollectionConfigured: false,
      })
      return true
    }
    if (path[3] === 'availability' && path.length === 4 && method === 'GET') {
      const query = z
        .object({
          serviceId: z.string().min(1).max(100),
          staffId: z.string().min(1).max(100),
          date: z.iso.date(),
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
        ),
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
      rateLimit(request, 'public-write', 20, 5 * 60000)
      const data = holdInput.parse(body)
      const raw = token(),
        expires = now() + 5 * 60000
      db.transaction(() => {
        const org = publicOrg(slug),
          blocked = withHolds(org),
          allocation = chooseStaff(blocked, data)
        const service = org.state.services.find((service) => service.id === data.serviceId)!
        const input: HoldAllocation = {
          ...data,
          ...allocation,
          duration: service.durationMinutes,
          buffer: service.bufferMinutes,
          price: service.priceMinor,
          deposit: service.depositMinor,
          resourceType: service.resourceType,
        }
        db.run('DELETE FROM booking_holds WHERE expires_at<=? AND appointment_id IS NULL', now())
        db.run(
          'INSERT INTO booking_holds(token_hash,id,organisation_id,input,expires_at) VALUES(?,?,?,?,?)',
          digest(raw),
          randomUUID(),
          org.id,
          JSON.stringify(input),
          expires,
        )
      })
      reply(201, { hold: raw, expiresAt: new Date(expires).toISOString() })
      return true
    }
    if (path[3] === 'book' && path.length === 4 && method === 'POST') {
      rateLimit(request, 'public-write', 20, 5 * 60000)
      const data = z
        .object({
          hold: z.string().min(32).max(100),
          contact: guestContact,
          policy: z.literal(true),
        })
        .strict()
        .parse(body)
      const fingerprint = digest(canonical(data.contact))
      const result = db.transaction(() => {
        const org = publicOrg(slug)
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
          return { appointmentId: hold!.appointment_id, replayed: true }
        }
        if (hold!.expires_at <= now()) fail(409, 'This reservation expired. Choose a time again.')
        const allocation = JSON.parse(hold!.input) as HoldAllocation
        const service = org.state.services.find((service) => service.id === allocation.serviceId)
        if (
          !service ||
          service.durationMinutes !== allocation.duration ||
          service.bufferMinutes !== allocation.buffer ||
          service.priceMinor !== allocation.price ||
          service.depositMinor !== allocation.deposit ||
          service.resourceType !== allocation.resourceType
        )
          fail(
            409,
            'This service changed during the reservation. Review it and choose a time again.',
          )
        chooseStaff(withHolds(org, hash), allocation, allocation.resourceId)
        const command = commandSchema.parse({
          type: 'book',
          input: {
            serviceId: allocation.serviceId,
            staffId: allocation.staffId,
            resourceId: allocation.resourceId,
            date: allocation.date,
            startMinutes: allocation.startMinutes,
            contact: data.contact,
            source: 'online',
          },
        })
        const result = dispatch(org.state, command, 'Guest booking', new Date(now()).toISOString())
        if (!result.ok) fail(422, result.error)
        persist(org, result.state, null, 'public.book', result.recordId)
        db.run(
          'UPDATE booking_holds SET appointment_id=?,fingerprint=? WHERE token_hash=?',
          result.recordId,
          fingerprint,
          hash,
        )
        return {
          appointmentId: result.recordId,
          sample: operations(org.state).mode === 'sandbox',
          depositPolicy: operations(org.state).mode === 'sandbox' ? 'simulated' : 'pay_at_studio',
          confirmation: 'local_only',
        }
      })
      reply(200, result)
      return true
    }
  }
  return false
}
