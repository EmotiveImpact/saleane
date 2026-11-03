import { isIP } from 'node:net'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { z } from 'zod'
import { digest } from './auth'
import { fail } from './http'
import type { Context } from './context'

/**
 * NEXT-15: signing in with Face ID, Touch ID, Windows Hello or a fingerprint, through a passkey
 * (WebAuthn) kept on the person's phone or computer. SALEANE keeps only the passkey's public key:
 * the face or finger never leaves the device, and nothing here can sign in on its own.
 */

/** How long a passkey prompt stays open before the person starts again. */
export const PASSKEY_CHALLENGE_MINUTES = 5
/** Passkeys one person may keep: plenty for a phone, a laptop and a spare. */
export const PASSKEYS_EACH = 10

export type PasskeyPlace = { rpID: string; origin: string }

/**
 * Where passkeys can work. Browsers allow them only on a secure address named by a domain, so
 * an IP address such as 127.0.0.1, or plain http anywhere but localhost, has none.
 */
export function passkeyPlace(origin: URL): PasskeyPlace | null {
  const host = origin.hostname
  if (isIP(host.replace(/^\[|\]$/g, ''))) return null
  const local = host === 'localhost' || host.endsWith('.localhost')
  if (origin.protocol !== 'https:' && !local) return null
  return { rpID: host, origin: origin.origin }
}

/** The account's id as the passkey holds it, so the device's answer names whose it is. */
export const userHandle = (accountId: string) =>
  Buffer.from(accountId, 'utf8').toString('base64url')

const base64url = z
  .string()
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]*$/)

const extensions = z.record(z.string(), z.unknown()).optional().default({})

export const registrationResponse = z
  .object({
    id: base64url.min(16).max(1400),
    rawId: base64url.min(16).max(1400),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: base64url,
        attestationObject: base64url,
        transports: z.array(z.string().max(20)).max(10).optional(),
        authenticatorData: base64url.optional(),
        publicKey: base64url.optional(),
        publicKeyAlgorithm: z.number().int().optional(),
      })
      .strip(),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: extensions,
  })
  .strip()

export const authenticationResponse = z
  .object({
    id: base64url.min(16).max(1400),
    rawId: base64url.min(16).max(1400),
    type: z.literal('public-key'),
    response: z
      .object({
        clientDataJSON: base64url,
        authenticatorData: base64url,
        signature: base64url,
        userHandle: base64url.optional(),
      })
      .strip(),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: extensions,
  })
  .strip()

type Purpose = 'add' | 'sign-in'

/** Keeps a new prompt's challenge, as a hash, until it is answered or runs out. */
function keepChallenge(ctx: Context, challenge: string, purpose: Purpose, accountId?: string) {
  const time = ctx.now()
  // Unanswered prompts are only random numbers, so those a day past their time are cleared away.
  ctx.db.run('DELETE FROM passkey_challenges WHERE expires_at<?', time - 24 * 3600_000)
  ctx.db.run(
    'INSERT INTO passkey_challenges(challenge_hash,purpose,account_id,created_at,expires_at) VALUES(?,?,?,?,?)',
    digest(challenge),
    purpose,
    accountId ?? null,
    time,
    time + PASSKEY_CHALLENGE_MINUTES * 60_000,
  )
}

/** Whether a challenge is still open for this purpose (and person, when adding). */
function openChallenge(ctx: Context, challenge: string, purpose: Purpose, accountId?: string) {
  return !!ctx.db.get(
    `SELECT 1 FROM passkey_challenges WHERE challenge_hash=? AND purpose=? AND used_at IS NULL
       AND expires_at>? AND (account_id IS ? OR account_id=?)`,
    digest(challenge),
    purpose,
    ctx.now(),
    accountId ?? null,
    accountId ?? null,
  )
}

/** Whether a challenge was this prompt's but has run out or been used: worth starting again. */
function spentChallenge(ctx: Context, challenge: string, purpose: Purpose, accountId?: string) {
  return (
    !!ctx.db.get(
      'SELECT 1 FROM passkey_challenges WHERE challenge_hash=? AND purpose=? AND (account_id IS ? OR account_id=?)',
      digest(challenge),
      purpose,
      accountId ?? null,
      accountId ?? null,
    ) && !openChallenge(ctx, challenge, purpose, accountId)
  )
}

/** Uses up a challenge inside the transaction that acts on it, so one answer counts once. */
function claimChallenge(ctx: Context, challenge: string, purpose: Purpose, accountId?: string) {
  return (
    ctx.db.run(
      `UPDATE passkey_challenges SET used_at=? WHERE challenge_hash=? AND purpose=? AND used_at IS NULL
         AND expires_at>? AND (account_id IS ? OR account_id=?)`,
      ctx.now(),
      digest(challenge),
      purpose,
      ctx.now(),
      accountId ?? null,
      accountId ?? null,
    ).changes === 1
  )
}

type PasskeyRow = {
  id: string
  account_id: string
  public_key: Uint8Array
  counter: number
  transports: string
  backed_up: number
  name: string
  created_at: number
  last_used_at: number | null
}

export type PasskeySummary = {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
  /** Kept in iCloud Keychain, Google Password Manager or similar, so the person's other devices have it too. */
  shared: boolean
}

export function passkeysOf(ctx: Context, accountId: string): PasskeySummary[] {
  return ctx.db
    .all<PasskeyRow>(
      'SELECT * FROM passkeys WHERE account_id=? AND removed_at IS NULL ORDER BY created_at',
      accountId,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      shared: row.backed_up === 1,
    }))
}

export const passkeyCount = (ctx: Context, accountId: string) =>
  ctx.db.get<{ total: number }>(
    'SELECT count(*) AS total FROM passkeys WHERE account_id=? AND removed_at IS NULL',
    accountId,
  )!.total

/** What the device is asked to make: a passkey that stays on it and always checks it is them. */
export async function addingOptions(
  ctx: Context,
  place: PasskeyPlace,
  account: { id: string; name: string; email: string },
) {
  const existing = ctx.db.all<{ id: string; transports: string }>(
    'SELECT id,transports FROM passkeys WHERE account_id=? AND removed_at IS NULL',
    account.id,
  )
  if (existing.length >= PASSKEYS_EACH)
    fail(
      409,
      `You already have ${PASSKEYS_EACH} devices set up. Remove one you no longer use first.`,
    )
  const options = await generateRegistrationOptions({
    rpName: 'SALEANE',
    rpID: place.rpID,
    userName: account.email,
    userDisplayName: account.name,
    userID: Buffer.from(account.id, 'utf8'),
    attestationType: 'none',
    // A device that already has one for this person says so instead of making a second.
    excludeCredentials: existing.map((row) => ({
      id: row.id,
      transports: JSON.parse(row.transports) as string[],
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: PASSKEY_CHALLENGE_MINUTES * 60_000,
  })
  keepChallenge(ctx, options.challenge, 'add', account.id)
  return options
}

const unreadable = 'Your device’s answer could not be checked. Try adding it again.'

/** Checks the device's new passkey and keeps its public key. */
export async function addPasskey(
  ctx: Context,
  place: PasskeyPlace,
  accountId: string,
  response: RegistrationResponseJSON,
  name: string,
) {
  let challenge = ''
  let checked: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    checked = await verifyRegistrationResponse({
      response,
      expectedChallenge: (given) => {
        challenge = given
        return openChallenge(ctx, given, 'add', accountId)
      },
      expectedOrigin: place.origin,
      expectedRPID: place.rpID,
      requireUserVerification: true,
    })
  } catch (error) {
    if (challenge && spentChallenge(ctx, challenge, 'add', accountId))
      fail(410, 'Adding this device took too long. Start again.')
    console.warn('[SALEANE] A new passkey was refused:', (error as Error).message)
    fail(400, unreadable)
  }
  if (!checked!.verified) fail(400, unreadable)
  const info = checked!.registrationInfo!
  const id = ctx.db.transaction(() => {
    if (!claimChallenge(ctx, challenge, 'add', accountId))
      fail(410, 'Adding this device took too long. Start again.')
    if (passkeyCount(ctx, accountId) >= PASSKEYS_EACH)
      fail(
        409,
        `You already have ${PASSKEYS_EACH} devices set up. Remove one you no longer use first.`,
      )
    if (ctx.db.get('SELECT 1 FROM passkeys WHERE id=?', info.credential.id))
      fail(409, 'This device is already set up to sign in.')
    ctx.db.run(
      'INSERT INTO passkeys(id,account_id,public_key,counter,transports,device_type,backed_up,name,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      info.credential.id,
      accountId,
      info.credential.publicKey,
      info.credential.counter,
      JSON.stringify(info.credential.transports ?? []),
      info.credentialDeviceType,
      info.credentialBackedUp ? 1 : 0,
      name,
      ctx.now(),
    )
    return info.credential.id
  })
  return id
}

/** A sign-in prompt for any passkey this device holds: no email is needed, and none is revealed. */
export async function signInOptions(ctx: Context, place: PasskeyPlace) {
  const options = await generateAuthenticationOptions({
    rpID: place.rpID,
    userVerification: 'required',
    timeout: PASSKEY_CHALLENGE_MINUTES * 60_000,
  })
  keepChallenge(ctx, options.challenge, 'sign-in')
  return options
}

export const PASSKEY_GONE =
  'This passkey is no longer set up for SALEANE. Sign in with your password, then add this device again.'

/**
 * Checks a passkey's answer and returns whose account it opens. The device has checked the face,
 * finger or PIN, so this counts as both steps: no code is asked for.
 */
export async function passkeySignIn(
  ctx: Context,
  place: PasskeyPlace,
  response: AuthenticationResponseJSON,
) {
  const row = ctx.db.get<PasskeyRow>(
    'SELECT * FROM passkeys WHERE id=? AND removed_at IS NULL',
    response.id,
  )
  if (!row) fail(401, PASSKEY_GONE)
  // A passkey that names its person must name the one it was made for.
  if (response.response.userHandle && response.response.userHandle !== userHandle(row!.account_id))
    fail(401, PASSKEY_GONE)
  let challenge = ''
  let checked: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
  try {
    checked = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (given) => {
        challenge = given
        return openChallenge(ctx, given, 'sign-in')
      },
      expectedOrigin: place.origin,
      expectedRPID: place.rpID,
      credential: {
        id: row!.id,
        publicKey: new Uint8Array(row!.public_key),
        counter: row!.counter,
        transports: JSON.parse(row!.transports) as string[],
      },
      requireUserVerification: true,
    })
  } catch (error) {
    const message = (error as Error).message
    if (challenge && spentChallenge(ctx, challenge, 'sign-in'))
      fail(410, 'That took too long. Try Face ID again.')
    // A count that went backwards can mean the passkey was copied off the device.
    if (/counter/i.test(message))
      fail(
        401,
        'This passkey could not be trusted, so it was not used. Sign in with your password, then remove it and add this device again.',
      )
    console.warn('[SALEANE] A passkey sign-in was refused:', message)
    fail(401, 'Face ID sign-in could not be checked. Try again or use your password.')
  }
  if (!checked!.verified)
    fail(401, 'Face ID sign-in could not be checked. Try again or use your password.')
  const info = checked!.authenticationInfo
  ctx.db.transaction(() => {
    if (!claimChallenge(ctx, challenge, 'sign-in'))
      fail(410, 'That took too long. Try Face ID again.')
    const still = ctx.db.run(
      'UPDATE passkeys SET counter=?, backed_up=?, last_used_at=? WHERE id=? AND removed_at IS NULL',
      info.newCounter,
      info.credentialBackedUp ? 1 : 0,
      ctx.now(),
      row!.id,
    ).changes
    if (!still) fail(401, PASSKEY_GONE)
  })
  return row!.account_id
}

/** Stops a passkey from signing in. The row is kept, with when and why, and never used again. */
export function removePasskey(ctx: Context, accountId: string, id: string) {
  const row = ctx.db.get<{ name: string }>(
    'SELECT name FROM passkeys WHERE id=? AND account_id=? AND removed_at IS NULL',
    id,
    accountId,
  )
  if (!row) fail(404, 'That device is not set up to sign in.')
  ctx.db.run(
    "UPDATE passkeys SET removed_at=?, removed_why='person' WHERE id=? AND account_id=?",
    ctx.now(),
    id,
    accountId,
  )
  return row!.name
}
