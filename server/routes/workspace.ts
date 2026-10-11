import { z } from 'zod'
import { digest, token } from '../auth'
import { canonical, fail, header } from '../http'
import {
  availableResource,
  commandSchema,
  dispatch,
  execute,
  rescheduleResource,
} from '../../src/domain/commands'
import type { Command } from '../../src/domain/commands'
import { dateLabel, timeLabel } from '../../src/domain/format'
import { businessDate, can, operations, permissionFor } from '../../src/domain/operations'
import type { Role } from '../../src/domain/operations'
import { emailSchema, roleSchema } from '../context'
import type { Context, Route } from '../context'
import { practitionerRefusal } from '../../src/domain/practitioner'
import { branchChangeRefusal, branchRefusal } from '../../src/domain/branch'
import { areaRefusal } from '../../src/domain/area'
import { openingFree, staleOffer } from '../../src/domain/waitlist'
import { giftCardHoldProblem } from '../payments/service'
import { workspaceView } from '../projections'
import type { Reader } from '../projections'
import { followGuestLinks, issueGuestLink, revokeGuestLinks } from './guest'

/** Signed-in workspace routes: records, commands, team, invitations and audit. Returns false when the request belongs to another module. */
export async function workspaceRoutes(ctx: Context, route: Route): Promise<boolean> {
  const {
    allowedOrigin,
    db,
    now,
    actorFor,
    orgFor,
    audit,
    persist,
    withHolds,
    chooseStaff,
    linkableProfessional,
    linkableArea,
    linkableLocation,
  } = ctx
  const { request, method, path, body, reply } = route
  if (path[1] === 'workspaces' && path[2]) {
    const actor = actorFor(request, method !== 'GET')
    const orgId = path[2]
    if (path.length === 3 && method === 'GET') {
      // A regional manager reads here too, through their area's view only.
      const org = orgFor(orgId, actor, { area: true })
      const today = businessDate(org.state, new Date(now()).toISOString())
      reply(200, {
        id: org.id,
        slug: org.slug,
        role: org.role,
        staffId: org.staffId,
        ...(org.role === 'general' ? { locationId: org.locationId } : {}),
        ...workspaceView(org, org.state, today, now()),
        today,
        mode: operations(org.state).mode,
        deliveryConfigured: ctx.messaging.email.live || ctx.messaging.sms.live,
        paymentsConfigured: ctx.paymentProvider.live,
        // NEXT-02: whether the studio is read only, and its plan's dates for the owner.
        billing: ctx.plans.summary(org),
      })
      return true
    }
    if (path[3] === 'commands' && path.length === 4 && method === 'POST') {
      const data = z
        .object({ revision: z.number().int().nonnegative(), command: commandSchema })
        .strict()
        .parse(body)
      // A card payment enters the record only when the payment provider confirms it.
      if (
        ('method' in data.command && data.command.method === 'card') ||
        'processor' in data.command
      )
        fail(403, 'Card payments are taken through the payment screen, not recorded by hand.')
      if (data.command.type === 'organisation' && data.command.botCheck && !ctx.turnstile)
        fail(
          422,
          'Add the Cloudflare Turnstile keys to this server before switching on the bot check.',
        )
      const key = header(request, 'idempotency-key')
      if (!key || !/^[A-Za-z0-9._:-]{8,100}$/.test(key))
        fail(400, 'Use an idempotency key between 8 and 100 safe characters.')
      const fingerprint = digest(canonical(data.command))
      let reader!: Reader
      const result = db.transaction(() => {
        const org = orgFor(orgId, actor, { area: true })
        reader = org
        // A batch is allowed by its changes; a setup screen needs the right to set up the studio
        // and to make each of its changes.
        const parts =
          data.command.type === 'batch'
            ? data.command.commands
            : data.command.type === 'setup-step'
              ? [data.command, ...data.command.changes]
              : [data.command]
        if (parts.some((part) => !can(org.role, permissionFor(part))))
          fail(403, 'Your role cannot make this change.')
        if (org.role === 'regional') {
          const refusal = org.areaId
            ? areaRefusal(org.state, org.areaId, data.command, actor.id)
            : 'Your access is not linked to a region.'
          if (refusal) fail(403, refusal)
        }
        if (org.role === 'general') {
          const refusal = org.locationId
            ? branchRefusal(org.state, org.locationId, data.command)
            : 'Your access is not linked to a location.'
          if (refusal) fail(403, refusal)
        }
        if (org.role === 'practitioner') {
          const refusal = practitionerRefusal(
            org.state,
            org.staffId!,
            data.command,
            businessDate(org.state, new Date(now()).toISOString()),
          )
          if (refusal) fail(403, refusal)
        }
        const receipt = db.get<{ fingerprint: string; record_id: string }>(
          'SELECT fingerprint,record_id FROM command_receipts WHERE organisation_id=? AND account_id=? AND key=?',
          org.id,
          actor.id,
          key!,
        )
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            fail(409, 'This request key was already used for a different change.')
          return { ok: true, state: org.state, recordId: receipt.record_id, replayed: true }
        }
        if (org.state.revision !== data.revision)
          fail(409, 'Someone else saved a change just now. Reload to see it, then try again.')
        let command: Command = data.command
        // V5: a request goes to its region's manager only when the region has one, and never to
        // the person who raised it; the client's own list and claims are never trusted.
        const managedRegions = () =>
          db
            .all<{ area_id: string }>(
              "SELECT DISTINCT area_id FROM memberships WHERE organisation_id=? AND role='regional'",
              org.id,
            )
            .map((row) => row.area_id)
        if (command.type === 'own-voice') {
          // NEXT-16: a person only ever chooses their own voice.
          command = { ...command, personId: actor.id }
        } else if (command.type === 'visit-write-up') {
          // NEXT-16: aftercare is signed only by the professional who wrote it, never by the desk.
          const { signedBy: _claimed, ...rest } = command
          void _claimed
          command = org.role === 'practitioner' ? { ...rest, signedBy: org.staffId! } : rest
        } else if (command.type === 'request-raise') {
          command = {
            ...command,
            managedRegions: managedRegions(),
            raisedById: actor.id,
            raiserRegion: org.role === 'regional' ? (org.areaId ?? undefined) : undefined,
          }
        } else if (command.type === 'book') {
          // A general manager books at their own location unless they say otherwise.
          if (org.role === 'general' && !command.input.locationId)
            command = { ...command, input: { ...command.input, locationId: org.locationId! } }
          const allocation = chooseStaff(withHolds(org), command.input, command.input.resourceId)
          command = { ...command, input: { ...command.input, ...allocation } }
        } else if (command.type === 'book-repeat') {
          // NEXT-09: every visit of a repeat respects guests holding a time online, exactly as a
          // single booking does; the later ones keep the first visit's professional.
          let booking = command.booking
          if (org.role === 'general' && !booking.locationId)
            booking = { ...booking, locationId: org.locationId! }
          const held = withHolds(org)
          booking = { ...booking, ...chooseStaff(held, booking, booking.resourceId) }
          const at = new Date(now()).toISOString()
          const { locale } = org.state.organisation
          command = {
            ...command,
            booking,
            visits: command.visits.map((visit) => {
              const resourceId = availableResource(
                held,
                booking.serviceId,
                booking.staffId,
                visit.date,
                visit.startMinutes,
                at,
                visit.resourceId,
              )
              if (!resourceId)
                fail(
                  409,
                  `${dateLabel(visit.date, locale)} at ${timeLabel(visit.startMinutes, locale)}: that time was just taken. Choose another time or leave that visit out.`,
                )
              return { ...visit, resourceId }
            }),
          }
        } else if (command.type === 'book-together') {
          // NEXT-08: everyone booked together respects guests holding a time online, as a single
          // booking does. The whole booking is tried with the held times in place, and each
          // person keeps the professional and room found there.
          let booking = command.booking
          if (org.role === 'general' && !booking.locationId)
            booking = { ...booking, locationId: org.locationId! }
          const at = new Date(now()).toISOString()
          const asked = { ...command, booking }
          // Held times stand in as visits; a stand-in guest lets the booking be tried among them.
          const held = withHolds(org)
          held.clients.push({
            id: 'ephemeral-hold',
            organisationId: org.id,
            name: 'Held online',
            email: 'held-online@example.invalid',
            phone: '',
            preferences: '',
            marketingConsent: false,
            createdAt: at,
          })
          const trial = execute(held, asked, at)
          if (!trial.ok) {
            // Refused without anyone's hold too: the booking itself is wrong, so say why below.
            if (execute(org.state, asked, at).ok) fail(409, trial.error)
            command = asked
          } else {
            const lead = trial.state.appointments.find((a) => a.id === trial.recordId)!
            const party = trial.state.appointments.filter(
              (a) => a.together?.id === lead.together!.id,
            )
            const pinned = (i: number) => ({
              staffId: party[i].staffId,
              resourceId: party[i].resourceId,
            })
            command = {
              ...asked,
              booking: { ...booking, ...pinned(0) },
              guests: command.guests.map((guest, i) => ({ ...guest, ...pinned(i + 1) })),
            }
          }
        } else if (
          (command.type === 'gift-card-sell' || command.type === 'plan-sell') &&
          org.role === 'general'
        ) {
          // A general manager sells at their own location, so it counts in its takings.
          if (command.locationId && command.locationId !== org.locationId)
            fail(403, 'That is at another location.')
          command = { ...command, locationId: org.locationId! }
        } else if (command.type === 'reschedule') {
          const resourceId = rescheduleResource(
            withHolds(org),
            command.appointmentId,
            command.staffId,
            command.date,
            command.startMinutes,
            new Date(now()).toISOString(),
            command.resourceId,
            // A move to another location is checked there, not where the visit is now.
            command.locationId,
          )
          if (!resourceId) fail(409, 'This time is reserved or unavailable. Choose another time.')
          command = { ...command, resourceId }
        } else if (command.type === 'waitlist-offer') {
          // An offer must not describe a time another guest is holding while they book.
          const held = withHolds(org)
          const { entryId, date, startMinutes, staffId } = command
          const entry = held.waitlist?.find((e) => e.id === entryId)
          if (
            entry &&
            !openingFree(
              held,
              entry,
              { date, startMinutes, staffId },
              new Date(now()).toISOString(),
            )
          )
            fail(409, 'This time is reserved or unavailable. Choose another time.')
        } else if (command.type === 'message-queue') {
          // Approving a waitlist offer checks its time again, including guests holding it.
          const stale = staleOffer(withHolds(org), command.messageId, new Date(now()).toISOString())
          if (stale) fail(409, stale)
        } else if (command.type === 'batch') {
          // Each move in a batch respects online holds exactly as a single move does.
          const held = withHolds(org)
          const at = new Date(now()).toISOString()
          command = {
            ...command,
            commands: command.commands.map((part) => {
              if (part.type !== 'reschedule') return part
              const move = part as Extract<Command, { type: 'reschedule' }>
              const resourceId = rescheduleResource(
                held,
                move.appointmentId,
                move.staffId,
                move.date,
                move.startMinutes,
                at,
                move.resourceId,
                move.locationId,
              )
              if (!resourceId)
                fail(409, 'A time in this plan is reserved or unavailable. Ask again.')
              return { ...move, resourceId }
            }),
          }
        }
        const result = dispatch(org.state, command, actor.name, new Date(now()).toISOString())
        if (!result.ok) fail(422, result.error)
        if (org.role === 'general') {
          const refusal = branchChangeRefusal(org.state, result.state, org.locationId!)
          if (refusal) fail(403, refusal)
        }
        const held = giftCardHoldProblem(ctx, org.id, result.state)
        if (held) fail(409, held)
        if (result.state.revision !== org.state.revision)
          persist(org, result.state, actor.id, command.type, result.recordId)
        // Open guest links follow a visit the desk moves, as they do when the guest moves it.
        const moves = command.type === 'batch' ? command.commands : [command]
        for (const move of moves)
          if (move.type === 'reschedule')
            followGuestLinks(
              ctx,
              { ...org, state: result.state },
              (move as Extract<Command, { type: 'reschedule' }>).appointmentId,
            )
        db.run(
          'INSERT INTO command_receipts(organisation_id,account_id,key,fingerprint,record_id,revision,created_at) VALUES(?,?,?,?,?,?,?)',
          org.id,
          actor.id,
          key!,
          fingerprint,
          result.recordId,
          result.state.revision,
          now(),
        )
        return result
      })
      const { state, ...outcome } = result
      reply(200, {
        ...outcome,
        ...workspaceView(reader, state, businessDate(state, new Date(now()).toISOString()), now()),
      })
      return true
    }
    if (path[3] === 'team' && path.length === 4 && method === 'GET') {
      const org = orgFor(orgId, actor)
      if (org.role !== 'owner') fail(403, 'Only the owner can manage access.')
      reply(200, {
        // NEXT-04: the owner sees who has two-step sign-in on, never their keys or codes.
        members: db
          .all<Record<string, unknown> & { twoStep: number }>(
            'SELECT a.id,a.name,a.email,m.role,m.staff_id AS staffId,m.area_id AS areaId,m.location_id AS locationId,(a.totp_enabled_at IS NOT NULL) AS twoStep FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.organisation_id=? ORDER BY a.name',
            org.id,
          )
          .map((member) => ({ ...member, twoStep: member.twoStep === 1 })),
        invitations: db.all(
          'SELECT email,role,staff_id AS staffId,area_id AS areaId,location_id AS locationId,expires_at AS expiresAt FROM invitations WHERE organisation_id=? AND used_at IS NULL AND expires_at>?',
          org.id,
          now(),
        ),
      })
      return true
    }
    if (path[3] === 'invitations' && path.length === 4 && method === 'POST') {
      const data = z
        .object({
          email: emailSchema,
          role: roleSchema,
          staffId: z.string().min(1).max(100).optional(),
          areaId: z.string().min(1).max(150).optional(),
          locationId: z.string().min(1).max(150).optional(),
        })
        .strict()
        .parse(body)
      const raw = token(),
        expiresAt = now() + 48 * 60 * 60000
      db.transaction(() => {
        const org = orgFor(orgId, actor)
        if (org.role !== 'owner') fail(403, 'Only the owner can invite staff.')
        const member = db.get(
          'SELECT a.id FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.organisation_id=? AND a.email=?',
          org.id,
          data.email,
        )
        if (member) fail(409, 'This person already belongs to the workspace.')
        const staffId =
          data.role === 'practitioner' ? linkableProfessional(org, data.staffId) : null
        const areaId = data.role === 'regional' ? linkableArea(org, data.areaId) : null
        const locationId = data.role === 'general' ? linkableLocation(org, data.locationId) : null
        db.run(
          'UPDATE invitations SET used_at=? WHERE organisation_id=? AND email=? AND used_at IS NULL',
          now(),
          org.id,
          data.email,
        )
        db.run(
          'INSERT INTO invitations(token_hash,organisation_id,email,role,staff_id,area_id,location_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
          digest(raw),
          org.id,
          data.email,
          data.role,
          staffId,
          areaId,
          locationId,
          now(),
          expiresAt,
        )
        audit(org, actor.id, 'invitation.created', digest(data.email), undefined, {
          fields: [{ f: 'access', to: data.role }],
        })
      })
      reply(201, {
        url: `${allowedOrigin}/join?invitation=${raw}`,
        invitation: raw,
        expiresAt: new Date(expiresAt).toISOString(),
        delivery: 'not_sent',
      })
      return true
    }
    if (path[3] === 'membership' && path.length === 4 && method === 'POST') {
      const data = z
        .object({
          accountId: z.string().min(1).max(100),
          role: z.enum(['manager', 'reception', 'practitioner', 'regional', 'general', 'remove']),
          staffId: z.string().min(1).max(100).optional(),
          areaId: z.string().min(1).max(150).optional(),
          locationId: z.string().min(1).max(150).optional(),
        })
        .strict()
        .parse(body)
      db.transaction(() => {
        const org = orgFor(orgId, actor)
        if (org.role !== 'owner') fail(403, 'Only the owner can change access.')
        const member = db.get<{ role: Role }>(
          'SELECT role FROM memberships WHERE organisation_id=? AND account_id=?',
          org.id,
          data.accountId,
        )
        if (!member || member.role === 'owner') fail(422, 'Owner access cannot be changed here.')
        if (data.role === 'remove')
          db.run(
            'DELETE FROM memberships WHERE organisation_id=? AND account_id=?',
            org.id,
            data.accountId,
          )
        else
          db.run(
            'UPDATE memberships SET role=?,staff_id=?,area_id=?,location_id=? WHERE organisation_id=? AND account_id=?',
            data.role,
            data.role === 'practitioner'
              ? linkableProfessional(org, data.staffId, data.accountId)
              : null,
            data.role === 'regional' ? linkableArea(org, data.areaId) : null,
            data.role === 'general' ? linkableLocation(org, data.locationId) : null,
            org.id,
            data.accountId,
          )
        audit(org, actor.id, 'membership.changed', data.accountId, undefined, {
          fields: [{ f: 'access', from: member!.role, to: data.role }],
        })
      })
      reply(200, { ok: true })
      return true
    }
    if (path[3] === 'guest-links' && method === 'POST' && path.length <= 5) {
      const revoke = path[4] === 'revoke'
      if (path.length === 5 && !revoke) return false
      const data = z
        .object({ appointmentId: z.string().min(1).max(100) })
        .strict()
        .parse(body)
      const result = db.transaction(() => {
        const org = orgFor(orgId, actor)
        if (!['owner', 'manager', 'reception', 'general'].includes(org.role))
          fail(403, 'Your role cannot manage guest links.')
        const appointment = org.state.appointments.find((a) => a.id === data.appointmentId)
        if (!appointment) fail(404, 'This visit is not in the studio record.')
        if (org.role === 'general' && appointment!.locationId !== org.locationId)
          fail(403, 'That visit is at another location.')
        if (revoke) {
          const revoked = revokeGuestLinks(ctx, org, data.appointmentId)
          audit(org, actor.id, 'guest_link.revoked', data.appointmentId)
          return { revoked }
        }
        if (appointment!.status !== 'confirmed')
          fail(409, 'Only an upcoming visit can have a manage link.')
        const link = issueGuestLink(ctx, org, data.appointmentId, 'desk')
        audit(org, actor.id, 'guest_link.created', data.appointmentId)
        return link
      })
      reply(revoke ? 200 : 201, result)
      return true
    }
    if (path[3] === 'audit' && path.length === 4 && method === 'GET') {
      const org = orgFor(orgId, actor)
      if (!['owner', 'manager', 'general'].includes(org.role))
        fail(403, 'A manager role is required.')
      // Only some kinds of entry, such as the privacy record's, so busy days never push them out.
      const actions = z
        .string()
        .max(1000)
        .optional()
        .parse(route.url.searchParams.get('actions') ?? undefined)
        ?.split(',')
        .filter(Boolean)
      reply(200, {
        events: db.all(
          `SELECT e.id,e.action,e.record_id AS recordId,e.revision,e.occurred_at AS occurredAt,COALESCE(a.name,CASE WHEN e.action='workspace.restored' THEN 'Local recovery' ELSE 'Guest booking' END) AS actor FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.organisation_id=?${
            actions?.length ? ' AND e.action IN (SELECT value FROM json_each(?))' : ''
          } ORDER BY e.occurred_at DESC,e.rowid DESC LIMIT 200`,
          org.id,
          ...(actions?.length ? [JSON.stringify(actions)] : []),
        ),
      })
      return true
    }
  }
  return false
}
