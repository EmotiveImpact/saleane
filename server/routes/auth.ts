import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { checkPassword, digest, passwordHash } from '../auth'
import { COOKIE, fail, sessionToken } from '../http'
import { createWorkspace, workspaceInput } from '../workspace'
import { claimLink, linkInLog, mailLink, openLink, tooManyLinks } from '../accountMail'
import { emailSchema, registration } from '../context'
import { brandFigures, brandGroup } from '../../src/domain/brandGroup'
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
    orgFor,
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
    const confirmed = db.get<{ at: number | null }>(
      'SELECT email_confirmed_at AS at FROM accounts WHERE id=?',
      actor.id,
    )?.at
    reply(200, {
      user: { id: actor.id, name: actor.name, email: actor.email, emailConfirmed: !!confirmed },
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
    // The address is confirmed by a link sent to it. Nothing waits on it; the account works at once.
    mailLink(ctx, { id: accountId, name: data.name, email: data.email }, 'confirm')
    reply(201, { orgId, csrf: signIn(response, accountId) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/forgot') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z.object({ email: emailSchema }).strict().parse(body)
    const account = db.get<{ id: string; name: string; email: string }>(
      'SELECT id,name,email FROM accounts WHERE email=?',
      data.email,
    )
    // The same answer, just as quickly, either way, so the page never tells anyone which
    // addresses have accounts. An inbox already sent an hour's worth of links gets no more.
    if (account && !tooManyLinks(ctx, account.id, 'reset')) mailLink(ctx, account, 'reset')
    reply(200, { ok: true, emailConnected: ctx.messaging.email.live, linkInLog: linkInLog(ctx) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/reset') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ token: z.string().min(32).max(100), password: z.string().min(12).max(128) })
      .strict()
      .parse(body)
    const closed =
      'This link has expired or has already been used. Ask for a new one from the sign-in page.'
    if (!openLink(ctx, data.token, 'reset')) fail(400, closed)
    const hash = await passwordHash(data.password)
    const accountId = db.transaction(() => {
      // Checked again here: the same link may have been used while the password was hashed.
      const link = claimLink(ctx, data.token, 'reset')
      if (!link) fail(400, closed)
      // Opening the emailed link also shows the address is theirs.
      db.run(
        'UPDATE accounts SET password_hash=?, email_confirmed_at=COALESCE(email_confirmed_at,?) WHERE id=?',
        hash,
        now(),
        link!.account_id,
      )
      // Every signed-in device is signed out.
      db.run('DELETE FROM sessions WHERE account_id=?', link!.account_id)
      return link!.account_id
    })
    reply(200, { csrf: signIn(response, accountId) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/confirm') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ token: z.string().min(32).max(100) })
      .strict()
      .parse(body)
    db.transaction(() => {
      const link = claimLink(ctx, data.token, 'confirm')
      if (!link)
        fail(400, 'This link has expired or has already been used. Sign in to send a new one.')
      db.run(
        'UPDATE accounts SET email_confirmed_at=COALESCE(email_confirmed_at,?) WHERE id=?',
        now(),
        link!.account_id,
      )
    })
    reply(200, { ok: true })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/confirm/resend') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    const confirmed = db.get<{ at: number | null }>(
      'SELECT email_confirmed_at AS at FROM accounts WHERE id=?',
      actor.id,
    )?.at
    if (!confirmed) {
      if (tooManyLinks(ctx, actor.id, 'confirm'))
        fail(
          429,
          'Several links have gone out in the last hour. Use the newest, or try again later.',
        )
      mailLink(ctx, actor, 'confirm')
    }
    reply(200, {
      ok: true,
      emailConnected: ctx.messaging.email.live,
      linkInLog: linkInLog(ctx),
      confirmed: !!confirmed,
    })
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
  if (method === 'GET' && url.pathname === '/api/group') {
    // V5: the brands this person owns, side by side from totals only. A manager's or desk
    // member's studios are never included: only an owner sees a brand's whole figures.
    const actor = actorFor(request)
    const iso = new Date(now()).toISOString()
    const owned = memberships(actor).filter((w) => w.role === 'owner')
    reply(200, brandGroup(owned.map((w) => brandFigures(orgFor(w.id, actor), iso))))
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
