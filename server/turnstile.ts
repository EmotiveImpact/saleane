/**
 * Optional Cloudflare Turnstile bot check for public booking holds.
 * Keys come from server environment only; a studio can switch the check on once they exist.
 */
export type TurnstileVerify = (token: string, remoteAddress: string) => Promise<boolean>
export type Turnstile = { siteKey: string; verify: TurnstileVerify }

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** Cloudflare's published test keys: these site and secret keys always pass. */
export const TURNSTILE_TEST_KEYS = {
  siteKey: '1x00000000000000000000AA',
  secretKey: '1x0000000000000000000000000000000AA',
  failingSecretKey: '2x0000000000000000000000000000000AA',
  dummyToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

/** Server-side token check. Any network, status or parsing failure counts as not passed. */
export function siteverify(
  secretKey: string,
  request: typeof fetch = fetch,
  timeoutMs = 5000,
): TurnstileVerify {
  return async (token, remoteAddress) => {
    try {
      const body = new URLSearchParams({ secret: secretKey, response: token })
      if (remoteAddress) body.set('remoteip', remoteAddress)
      const response = await request(SITEVERIFY, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return false
      const result = (await response.json()) as { success?: unknown }
      return result.success === true
    } catch {
      return false
    }
  }
}

/** Both keys must be present; anything else leaves the check unavailable. */
export function turnstileFromEnv(env: NodeJS.ProcessEnv = process.env): Turnstile | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim(),
    secretKey = env.TURNSTILE_SECRET_KEY?.trim()
  if (!siteKey || !secretKey) return null
  return { siteKey, verify: siteverify(secretKey) }
}
