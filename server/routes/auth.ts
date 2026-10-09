import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { checkPassword, digest, passwordHash } from '../auth'
import { COOKIE, fail, sessionToken } from '../http'
import { createWorkspace, workspaceInput } from '../workspace'
import { emailSchema, registration } from '../context'
import type { Context, Invitation, Route } from '../context'
import { placeOf } from '../../src/domain/locations'
import { regions } from '../../src/domain/group'

/** Health, session, account and workspace-creation routes. Returns false when the request belongs to another module. */
export async function authRoutes(ctx: Context, route: Route): Promise<boolean> {
  const {
    options,
    origin,
    db,
    now,
    dummyHash,
    rateLimit,
    actorFor,
    signIn,
    memberships,
    insertWorkspace,
    invitationFor,
    join,
    systemOrg,
  } = ctx
  const { request, response, method, url, body, reply } = route
  if (method === 'GET' && url.pathname === '/api/health') {
    reply(200, {
      ok: true,
      database: 'sqlite',
      localOnly: true,
      services: {
        email: ctx.messaging.email.live || ctx.messaging.sms.live,
        payments: ctx.paymentProvider.live,
      },
    })
    return true
  }
  if (method === 'GET' && url.pathname === '/api/session') {
    const actor = actorFor(request)
    reply(200, {
      user: { id: actor.id, name: actor.name, email: actor.email },
      csrf: actor.csrf,
      workspaces: memberships(actor),
      localOnly: true,
      services: {
        email: ctx.messaging.email.live || ctx.messaging.sms.live,
        payments: ctx.paymentProvider.live,
      },
    })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/register') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    if (options.allowRegistration === false) fail(403, 'New account registration is disabled.')
    const data = registration.parse(body)
    if (!!data.workspace === !!data.invitation)
      fail(400, 'Choose a new workspace or use an invitation.')
    const accountId = randomUUID(),
      hash = await passwordHash(data.password)
    const orgId = db.transaction(() => {
      if (db.get('SELECT id FROM accounts WHERE email=?', data.email))
        fail(409, 'An account could not be created with these details. Try signing in.')
      const invite = data.invitation ? invitationFor(data.invitation, data.email) : undefined
      db.run(
        'INSERT INTO accounts(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        accountId,
        data.email,
        data.name,
        hash,
        now(),
      )
      return invite
        ? join(invite, accountId)
        : insertWorkspace(createWorkspace(data.workspace!), accountId).id
    })
    reply(201, { orgId, csrf: signIn(response, accountId) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ email: emailSchema, password: z.string().min(1).max(128) })
      .strict()
      .parse(body)
    const account = db.get<{ id: string; password_hash: string }>(
      'SELECT id,password_hash FROM accounts WHERE email=?',
      data.email,
    )
    const valid = await checkPassword(data.password, account?.password_hash ?? (await dummyHash))
    if (!valid || !account) fail(401, 'Email or password is incorrect.')
    reply(200, { csrf: signIn(response, account!.id) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    actorFor(request, true)
    db.run('DELETE FROM sessions WHERE token_hash=?', digest(sessionToken(request)!))
    response.setHeader(
      'Set-Cookie',
      `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${origin.protocol === 'https:' ? '; Secure' : ''}`,
    )
    reply(200, { ok: true })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/password') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ current: z.string().min(1).max(128), password: z.string().min(12).max(128) })
      .strict()
      .parse(body)
    const account = db.get<{ password_hash: string }>(
      'SELECT password_hash FROM accounts WHERE id=?',
      actor.id,
    )!
    if (!(await checkPassword(data.current, account.password_hash)))
      fail(403, 'The current password is incorrect.')
    const hash = await passwordHash(data.password)
    db.transaction(() => {
      db.run('UPDATE accounts SET password_hash=? WHERE id=?', hash, actor.id)
      db.run('DELETE FROM sessions WHERE account_id=?', actor.id)
    })
    reply(200, { csrf: signIn(response, actor.id) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/workspaces') {
    const actor = actorFor(request, true)
    const data = z.object({ workspace: workspaceInput }).strict().parse(body)
    const org = db.transaction(() => insertWorkspace(createWorkspace(data.workspace), actor.id))
    reply(201, { orgId: org.id, slug: org.slug })
    return true
  }
  // The join page names the studio and the role before anyone signs in. A link that is still open
  // reads only the studio's name, the role, the location or region it covers and the email it was
  // sent to. Reading it changes nothing; the link is used up only when someone joins.
  if (method === 'POST' && url.pathname === '/api/invitations/preview') {
    rateLimit(request, 'invitation-read', 30, 5 * 60000)
    const data = z
      .object({ invitation: z.string().min(32).max(100) })
      .strict()
      .parse(body)
    const invite = db.get<Invitation>(
      'SELECT * FROM invitations WHERE token_hash=? AND expires_at>? AND used_at IS NULL',
      digest(data.invitation),
      now(),
    )
    const org = invite ? systemOrg(invite.organisation_id) : null
    if (!invite || !org)
      fail(
        404,
        'This invitation has expired or has already been used. Ask the studio owner for a new link.',
      )
    const state = org!.state
    const location =
      invite!.role === 'general' && invite!.location_id
        ? placeOf(state, invite!.location_id)?.name
        : undefined
    const region =
      invite!.role === 'regional'
        ? regions(state).find((r) => r.id === invite!.area_id)?.name
        : undefined
    reply(200, {
      studio: state.organisation.name,
      role: invite!.role,
      ...(location ? { location } : {}),
      ...(region ? { region } : {}),
      email: invite!.email,
    })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/invitations/accept') {
    const actor = actorFor(request, true),
      data = z
        .object({ invitation: z.string().min(32).max(100) })
        .strict()
        .parse(body)
    const orgId = db.transaction(() => join(invitationFor(data.invitation, actor.email), actor.id))
    reply(200, { orgId })
    return true
  }
  return false
}
