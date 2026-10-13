import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { checkPassword, digest, passwordHash } from '../auth'
import { COOKIE, fail, sessionToken } from '../http'
import { createWorkspace, workspaceInput } from '../workspace'
import { claimLink, linkInLog, mailLink, mailNotice, openLink, tooManyLinks } from '../accountMail'
import {
  CHALLENGE_TRIES,
  matchStep,
  newChallenge,
  newRecoveryCodes,
  newSecret,
  openChallenge,
  recoveryLeft,
  setupUri,
  useCode,
} from '../twoStep'
import type { TwoStepAccount } from '../twoStep'
import {
  addPasskey,
  addingOptions,
  authenticationResponse,
  passkeyCount,
  passkeyPlace,
  passkeySignIn,
  passkeysOf,
  registrationResponse,
  removePasskey,
  signInOptions,
} from '../passkeys'
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
  const twoStepAccount = (accountId: string) =>
    db.get<TwoStepAccount>(
      'SELECT id,totp_secret,totp_last_step FROM accounts WHERE id=? AND totp_enabled_at IS NOT NULL',
      accountId,
    )
  const twoStepOn = (accountId: string) => !!twoStepAccount(accountId)
  // NEXT-15: passkeys work only on an address a browser allows them on.
  const passkeys = passkeyPlace(origin)
  const noPasskeys = () =>
    fail(404, 'Face ID sign-in needs SALEANE on a secure web address, so it is not available here.')
  /** Changing how someone signs in asks for their password again. */
  async function passwordFor(accountId: string, password: string) {
    const account = db.get<{ password_hash: string }>(
      'SELECT password_hash FROM accounts WHERE id=?',
      accountId,
    )!
    if (!(await checkPassword(password, account.password_hash)))
      fail(403, 'The password is incorrect.')
  }
  if (method === 'GET' && url.pathname === '/api/health') {
    reply(200, {
      ok: true,
      database: 'sqlite',
      localOnly: true,
      passkeysHere: !!passkeys,
      services: {
        email: ctx.messaging.email.live || ctx.messaging.sms.live,
        payments: ctx.paymentProvider.live,
        ai: ctx.ai.live,
        voice: ctx.voice.live,
      },
    })
    return true
  }
  if (method === 'GET' && url.pathname === '/api/session') {
    const actor = actorFor(request)
    const account = db.get<{ confirmed: number | null; twoStep: number | null; joinedAt: number }>(
      'SELECT email_confirmed_at AS confirmed, totp_enabled_at AS twoStep, created_at AS joinedAt FROM accounts WHERE id=?',
      actor.id,
    )
    reply(200, {
      user: {
        id: actor.id,
        name: actor.name,
        email: actor.email,
        emailConfirmed: !!account?.confirmed,
        // NEXT-04: when two-step sign-in was turned on, and how many recovery codes are left.
        twoStep: account?.twoStep
          ? { since: account.twoStep, recoveryLeft: recoveryLeft(ctx, actor.id) }
          : null,
        // NEXT-15: how many devices can sign in with Face ID or a fingerprint.
        passkeys: passkeyCount(ctx, actor.id),
        // The welcome as SALEANE opens greets a new person's very first visit (welcomeScene.ts).
        joinedAt: account?.joinedAt,
      },
      csrf: actor.csrf,
      passkeysHere: !!passkeys,
      workspaces: memberships(actor),
      localOnly: true,
      services: {
        email: ctx.messaging.email.live || ctx.messaging.sms.live,
        payments: ctx.paymentProvider.live,
        ai: ctx.ai.live,
        voice: ctx.voice.live,
      },
    })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/register') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    if (options.allowRegistration === false) fail(403, 'New account registration is disabled.')
    const data = registration.parse(body)
    if (!!data.workspace === !!data.invitation)
      fail(400, 'Choose a new studio or use an invitation.')
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
    const { accountId, twoStep } = db.transaction(() => {
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
      // Every signed-in device is signed out, and a sign-in started with the old password that
      // is waiting for its code can no longer finish.
      db.run('DELETE FROM sessions WHERE account_id=?', link!.account_id)
      db.run('DELETE FROM login_challenges WHERE account_id=?', link!.account_id)
      const on = db.get<{ at: number | null }>(
        'SELECT totp_enabled_at AS at FROM accounts WHERE id=?',
        link!.account_id,
      )?.at
      return { accountId: link!.account_id, twoStep: !!on }
    })
    // NEXT-04: an emailed link proves the inbox, not the phone. With two-step sign-in on, the
    // new password is saved and the code is still asked for before anyone is signed in.
    if (twoStep) reply(200, { twoStep: true, challenge: newChallenge(ctx, accountId) })
    else reply(200, { csrf: signIn(response, accountId) })
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
    const account = db.get<{ id: string; password_hash: string; twoStep: number | null }>(
      'SELECT id,password_hash,totp_enabled_at AS twoStep FROM accounts WHERE email=?',
      data.email,
    )
    const valid = await checkPassword(data.password, account?.password_hash ?? (await dummyHash))
    if (!valid || !account) fail(401, 'Email or password is incorrect.')
    // NEXT-04: with two-step sign-in on, the password opens only a short step that asks for the code.
    if (account!.twoStep) reply(200, { twoStep: true, challenge: newChallenge(ctx, account!.id) })
    else reply(200, { csrf: signIn(response, account!.id) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/login/code') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ challenge: z.string().min(32).max(100), code: z.string().trim().min(6).max(20) })
      .strict()
      .parse(body)
    const restart =
      'This sign-in has timed out or had too many wrong codes. Start again with your password.'
    const outcome = db.transaction(() => {
      // 410: this sign-in step is gone, so the page goes back to the password.
      const found = openChallenge(ctx, data.challenge)
      if (!found) fail(410, restart)
      const used = useCode(ctx, found!, data.code)
      if (!used) {
        // Counted, not thrown, so the wrong try is kept when the answer goes back.
        db.run(
          'UPDATE login_challenges SET attempts=attempts+1 WHERE token_hash=?',
          digest(data.challenge),
        )
        return { accountId: '', used, left: CHALLENGE_TRIES - found!.attempts - 1 }
      }
      db.run(
        'UPDATE login_challenges SET used_at=? WHERE token_hash=?',
        now(),
        digest(data.challenge),
      )
      return { accountId: found!.id, used, left: 0 }
    })
    if (!outcome.used)
      if (outcome.left > 0)
        fail(400, 'That code is not right. Check your authenticator app and try the newest code.')
      else fail(410, restart)
    if (outcome.used === 'recovery') {
      const account = db.get<{ id: string; name: string; email: string }>(
        'SELECT id,name,email FROM accounts WHERE id=?',
        outcome.accountId,
      )!
      mailNotice(ctx, account, 'recovery-used')
    }
    reply(200, {
      csrf: signIn(response, outcome.accountId),
      recoveryLeft: outcome.used === 'recovery' ? recoveryLeft(ctx, outcome.accountId) : undefined,
    })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/two-step/start') {
    const actor = actorFor(request, true)
    z.object({}).strict().parse(body)
    if (twoStepOn(actor.id)) fail(409, 'Two-step sign-in is already on.')
    const secret = newSecret()
    db.run(
      'INSERT INTO totp_setup(account_id,secret,created_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET secret=excluded.secret, created_at=excluded.created_at',
      actor.id,
      secret,
      now(),
    )
    reply(200, { secret, uri: setupUri(secret, actor.email) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/two-step/confirm') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ code: z.string().trim().min(6).max(12) })
      .strict()
      .parse(body)
    const codes = db.transaction(() => {
      if (twoStepOn(actor.id)) fail(409, 'Two-step sign-in is already on.')
      // A key waiting more than half an hour is set up again, with a fresh one.
      const setup = db.get<{ secret: string }>(
        'SELECT secret FROM totp_setup WHERE account_id=? AND created_at>?',
        actor.id,
        now() - 30 * 60000,
      )
      if (!setup) fail(400, 'Setting up took too long. Start again to get a new key.')
      const step = matchStep(setup!.secret, data.code.replace(/\s/g, ''), now())
      if (step === undefined)
        fail(
          400,
          'That code is not right. Check the time on your phone is set automatically, then try the newest code.',
        )
      db.run(
        'UPDATE accounts SET totp_secret=?, totp_enabled_at=?, totp_last_step=? WHERE id=?',
        setup!.secret,
        now(),
        step!,
        actor.id,
      )
      db.run('DELETE FROM totp_setup WHERE account_id=?', actor.id)
      // Anyone else signed in as this person signs in again, now with a code.
      db.run(
        'DELETE FROM sessions WHERE account_id=? AND token_hash<>?',
        actor.id,
        digest(sessionToken(request)!),
      )
      return newRecoveryCodes(ctx, actor.id)
    })
    mailNotice(ctx, actor, 'two-step-on')
    reply(200, { recoveryCodes: codes })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/two-step/off') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(20) })
      .strict()
      .parse(body)
    await passwordFor(actor.id, data.password)
    db.transaction(() => {
      const account = twoStepAccount(actor.id)
      if (!account) fail(409, 'Two-step sign-in is already off.')
      if (!useCode(ctx, account!, data.code))
        fail(400, 'That code is not right. Use the newest code from your app, or a recovery code.')
      db.run(
        'UPDATE accounts SET totp_secret=NULL, totp_enabled_at=NULL, totp_last_step=NULL WHERE id=?',
        actor.id,
      )
      db.run('DELETE FROM recovery_codes WHERE account_id=?', actor.id)
      db.run(
        'UPDATE login_challenges SET used_at=? WHERE account_id=? AND used_at IS NULL',
        now(),
        actor.id,
      )
    })
    mailNotice(ctx, actor, 'two-step-off')
    reply(200, { ok: true })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/two-step/recovery') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ password: z.string().min(1).max(128) })
      .strict()
      .parse(body)
    await passwordFor(actor.id, data.password)
    const codes = db.transaction(() => {
      if (!twoStepOn(actor.id)) fail(409, 'Turn on two-step sign-in first.')
      return newRecoveryCodes(ctx, actor.id)
    })
    mailNotice(ctx, actor, 'recovery-new')
    reply(200, { recoveryCodes: codes })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/passkeys/options') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    if (!passkeys) noPasskeys()
    const data = z
      .object({
        password: z.string().min(1).max(128),
        code: z.string().trim().min(6).max(20).optional(),
      })
      .strict()
      .parse(body)
    await passwordFor(actor.id, data.password)
    // A new way in skips the code, so with two-step sign-in on, adding one asks for the code too.
    db.transaction(() => {
      const account = twoStepAccount(actor.id)
      if (!account) return
      if (!data.code) fail(400, 'Enter a code from your authenticator app, or a recovery code.')
      if (!useCode(ctx, account, data.code!))
        fail(400, 'That code is not right. Use the newest code from your app, or a recovery code.')
    })
    reply(200, await addingOptions(ctx, passkeys!, actor))
    return true
  }
  if (method === 'GET' && url.pathname === '/api/auth/passkeys') {
    const actor = actorFor(request)
    reply(200, { passkeys: passkeysOf(ctx, actor.id), here: !!passkeys })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/passkeys') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    if (!passkeys) noPasskeys()
    const data = z
      .object({ response: registrationResponse, name: z.string().trim().min(1).max(60) })
      .strict()
      .parse(body)
    await addPasskey(ctx, passkeys!, actor.id, data.response, data.name)
    // Anyone else signed in as this person stays signed in: nothing about the password changed.
    mailNotice(ctx, actor, 'passkey-added', data.name)
    reply(201, { passkeys: passkeysOf(ctx, actor.id) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/passkeys/remove') {
    const actor = actorFor(request, true)
    rateLimit(request, 'auth', 10, 5 * 60000)
    const data = z
      .object({ id: z.string().min(16).max(1400), password: z.string().min(1).max(128) })
      .strict()
      .parse(body)
    await passwordFor(actor.id, data.password)
    const name = db.transaction(() => removePasskey(ctx, actor.id, data.id))
    mailNotice(ctx, actor, 'passkey-removed', name)
    reply(200, { passkeys: passkeysOf(ctx, actor.id) })
    return true
  }
  // Signing in: the prompt is for any passkey the device holds, so no email is asked for and
  // the answer never says which addresses have accounts.
  if (method === 'POST' && url.pathname === '/api/auth/passkey/options') {
    rateLimit(request, 'passkey-prompt', 30, 5 * 60000)
    if (!passkeys) noPasskeys()
    z.object({})
      .strict()
      .parse(body ?? {})
    reply(200, await signInOptions(ctx, passkeys!))
    return true
  }
  if (method === 'POST' && url.pathname === '/api/auth/passkey') {
    rateLimit(request, 'auth', 10, 5 * 60000)
    if (!passkeys) noPasskeys()
    const data = z.object({ response: authenticationResponse }).strict().parse(body)
    const accountId = await passkeySignIn(ctx, passkeys!, data.response)
    reply(200, { csrf: signIn(response, accountId) })
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
      db.run('DELETE FROM login_challenges WHERE account_id=?', actor.id)
    })
    reply(200, { csrf: signIn(response, actor.id) })
    return true
  }
  if (method === 'GET' && url.pathname === '/api/group') {
    // V5: the brands this person owns, side by side from totals only. A manager's or desk
    // member's studios are never included: only an owner sees a brand's whole figures.
    const actor = actorFor(request)
    const iso = new Date(now()).toISOString()
    // Stage 6: a studio holding them until they set up two-step sign-in is left out until they do.
    const owned = memberships(actor).filter(
      (w) => w.role === 'owner' && !('twoStepRequired' in w && !ctx.twoStepOn(actor.id)),
    )
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
