import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  sendSignal,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { api, ApiError } from './api'

/**
 * NEXT-15: Face ID, Touch ID, Windows Hello or a fingerprint, through a passkey on this device.
 * The face or finger is checked by the device and never reaches SALEANE.
 */
export type Passkey = {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
  /** Kept in iCloud Keychain, Google Password Manager or similar, so other devices have it too. */
  shared: boolean
}

/** Said when the server no longer knows the passkey a device offered. */
export const PASSKEY_GONE =
  'This passkey is no longer set up for SALEANE. Sign in with your password, then add this device again.'

/** Whether this browser can use passkeys at all. */
export const passkeysInBrowser = () => {
  try {
    return browserSupportsWebAuthn()
  } catch {
    return false
  }
}

/** A name for the device the person is on, for them to change before it is kept. */
export function deviceName(agent = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  if (/iPhone/.test(agent)) return 'iPhone'
  if (/iPad/.test(agent)) return 'iPad'
  if (/Android/.test(agent)) return /Mobile/.test(agent) ? 'Android phone' : 'Android tablet'
  if (/CrOS/.test(agent)) return 'Chromebook'
  if (/Macintosh|Mac OS X/.test(agent)) return 'Mac'
  if (/Windows/.test(agent)) return 'Windows computer'
  return 'This device'
}

/** What the device or the browser said, in plain words; null when the person simply stopped. */
export function passkeyProblem(error: unknown, fallback: string): string | null {
  // A DOMException is not an Error everywhere, so its name is read directly.
  const name = (error as { name?: unknown } | null)?.name
  const code = error instanceof WebAuthnError ? error.code : ''
  if (code === 'ERROR_CEREMONY_ABORTED' || name === 'AbortError') return null
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError')
    return 'This device is already set up to sign in.'
  if (code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT')
    return 'This device cannot check your face, fingerprint or screen lock. Turn on a screen lock, then try again.'
  if (code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT')
    return 'This security key cannot keep a passkey. Use your phone or computer instead.'
  // The person closed the prompt, or it timed out: nothing to put right.
  if (name === 'NotAllowedError') return null
  if (error instanceof ApiError) return error.message
  return fallback
}

/** Makes a passkey on this device and keeps it; the password (and code) are checked first. */
export async function addPasskey(input: { password: string; code?: string; name: string }) {
  const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
    '/api/auth/passkeys/options',
    {
      method: 'POST',
      body: { password: input.password, ...(input.code ? { code: input.code } : {}) },
    },
  )
  // The device's own prompt can sit open for minutes while the person finds their phone.
  const response = await startRegistration({ optionsJSON })
  return api<{ passkeys: Passkey[] }>('/api/auth/passkeys', {
    method: 'POST',
    body: { response, name: input.name },
  })
}

/**
 * Signs in with a passkey this device holds. With `autofill`, the browser offers it beside the
 * email field instead of opening a prompt; another sign-in started meanwhile replaces it.
 */
export async function passkeySignIn(autofill = false) {
  if (autofill && !(await browserSupportsWebAuthnAutofill().catch(() => false))) return null
  const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>(
    '/api/auth/passkey/options',
    { method: 'POST', body: {} },
  )
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill })
  try {
    return await api<{ csrf: string }>('/api/auth/passkey', {
      method: 'POST',
      body: { response },
    })
  } catch (error) {
    // The device still offers a passkey SALEANE has removed, so it is told to forget it.
    if (error instanceof ApiError && error.message === PASSKEY_GONE && optionsJSON.rpId)
      void sendSignal({
        signalName: 'unknownCredential',
        rpID: optionsJSON.rpId,
        credentialID: response.id,
      }).catch(() => undefined)
    throw error
  }
}
