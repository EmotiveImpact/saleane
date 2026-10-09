import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { digest, token } from './auth'
import type { Context } from './context'

/**
 * NEXT-04: two-step sign-in with an authenticator app (time-based codes, RFC 6238), and recovery
 * codes for a lost phone. Everything runs on this server: no text message or outside service.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const STEP_SECONDS = 30
/** How long someone has after their password to enter the code. */
export const CHALLENGE_MINUTES = 5
/** Wrong codes allowed on one sign-in before they start again from their password. */
export const CHALLENGE_TRIES = 5
export const RECOVERY_CODES = 10
/** Recovery codes avoid letters and numbers that are easy to confuse: no 0, o, 1, l or i. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function toBase32(bytes: Uint8Array) {
  let bits = 0,
    value = 0,
    out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function fromBase32(text: string) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  const bytes: number[] = []
  let bits = 0,
    value = 0
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new Error('Not a base32 key.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** A new authenticator key: 160 random bits, as RFC 4226 recommends. */
export const newSecret = () => toBase32(randomBytes(20))

/** The six-digit code for one 30-second step. */
export function codeAt(secret: string, step: number) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', fromBase32(secret)).update(counter).digest()
  const offset = mac[mac.length - 1] & 15
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

const stepAt = (time: number) => Math.floor(time / 1000 / STEP_SECONDS)

/**
 * The step a code belongs to, allowing one step either side of now for a phone clock that is a
 * little out, or nothing. A step at or before `after` has been used already and never counts again.
 */
export function matchStep(secret: string, code: string, time: number, after = -1) {
  if (!/^\d{6}$/.test(code)) return undefined
  const now = stepAt(time)
  for (const step of [now, now - 1, now + 1]) {
    if (step <= after) continue
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(code))) return step
  }
  return undefined
}

/** What an authenticator app scans: the account is named by its email under SALEANE. */
export function setupUri(secret: string, email: string) {
  const label = encodeURIComponent(`SALEANE:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=SALEANE&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`
}

/** Spaces, hyphens and capitals are ignored, so a code can be typed however it was written down. */
export const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[\s-]/g, '')

function recoveryCode() {
  let raw = ''
  for (let i = 0; i < 10; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

/** Replaces every recovery code for the account and returns the new ones, shown only once. */
export function newRecoveryCodes(ctx: Context, accountId: string) {
  const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode)
  ctx.db.run('DELETE FROM recovery_codes WHERE account_id=?', accountId)
  for (const code of codes)
    ctx.db.run(
      'INSERT INTO recovery_codes(account_id,code_hash,created_at) VALUES(?,?,?)',
      accountId,
      digest(normaliseRecovery(code)),
      ctx.now(),
    )
  return codes
}

export const recoveryLeft = (ctx: Context, accountId: string) =>
  ctx.db.get<{ total: number }>(
    'SELECT count(*) AS total FROM recovery_codes WHERE account_id=? AND used_at IS NULL',
    accountId,
  )!.total

export type TwoStepAccount = {
  id: string
  totp_secret: string | null
  totp_last_step: number | null
}

/**
 * Checks a code from the app or an unused recovery code, and uses it up. Call inside the
 * transaction that acts on it, so the same code cannot be used twice at once.
 */
export function useCode(ctx: Context, account: TwoStepAccount, code: string) {
  const typed = code.trim()
  if (/^\d{6}$/.test(typed.replace(/\s/g, ''))) {
    if (!account.totp_secret) return undefined
    const step = matchStep(
      account.totp_secret,
      typed.replace(/\s/g, ''),
      ctx.now(),
      account.totp_last_step ?? -1,
    )
    if (step === undefined) return undefined
    ctx.db.run('UPDATE accounts SET totp_last_step=? WHERE id=?', step, account.id)
    return 'app' as const
  }
  const used = ctx.db.run(
    'UPDATE recovery_codes SET used_at=? WHERE account_id=? AND code_hash=? AND used_at IS NULL',
    ctx.now(),
    account.id,
    digest(normaliseRecovery(typed)),
  ).changes
  return used === 1 ? ('recovery' as const) : undefined
}

/** A short-lived step between the password and the code. No session exists until the code is right. */
export function newChallenge(ctx: Context, accountId: string) {
  const raw = token(),
    time = ctx.now()
  ctx.db.run(
    'INSERT INTO login_challenges(token_hash,account_id,created_at,expires_at) VALUES(?,?,?,?)',
    digest(raw),
    accountId,
    time,
    time + CHALLENGE_MINUTES * 60000,
  )
  return raw
}

export function openChallenge(ctx: Context, raw: string) {
  return ctx.db.get<TwoStepAccount & { attempts: number }>(
    `SELECT a.id, a.totp_secret, a.totp_last_step, c.attempts FROM login_challenges c
     JOIN accounts a ON a.id=c.account_id
     WHERE c.token_hash=? AND c.used_at IS NULL AND c.expires_at>? AND c.attempts<?
       AND a.totp_enabled_at IS NOT NULL`,
    digest(raw),
    ctx.now(),
    CHALLENGE_TRIES,
  )
}
