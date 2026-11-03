import { WebAuthnError } from '@simplewebauthn/browser'
import { expect, test } from 'vitest'
import { ApiError } from './api'
import { deviceName, passkeyProblem } from './passkeys'

// NEXT-15: the words around Face ID sign-in on the person's own device.
test('names the device from what the browser says it is', () => {
  const agents: [string, string][] = [
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1',
      'iPhone',
    ],
    ['Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15', 'iPad'],
    [
      'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Mobile Safari/537.36',
      'Android phone',
    ],
    ['Mozilla/5.0 (Linux; Android 16; SM-X910) AppleWebKit/537.36 Safari/537.36', 'Android tablet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'Mac'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0',
      'Windows computer',
    ],
    ['Mozilla/5.0 (X11; CrOS x86_64 16328.0.0) AppleWebKit/537.36', 'Chromebook'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0', 'This device'],
  ]
  for (const [agent, name] of agents) expect(deviceName(agent), agent).toBe(name)
})

test('says nothing when the person closed the prompt, and plain words otherwise', () => {
  const cause = new Error('cause')
  const fallback = 'This device could not be added.'
  expect(passkeyProblem(new DOMException('closed', 'NotAllowedError'), fallback)).toBeNull()
  expect(
    passkeyProblem(
      new WebAuthnError({
        message: 'x',
        code: 'ERROR_CEREMONY_ABORTED',
        cause,
        name: 'AbortError',
      }),
      fallback,
    ),
  ).toBeNull()
  expect(
    passkeyProblem(
      new WebAuthnError({
        message: 'x',
        code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED',
        cause,
        name: 'InvalidStateError',
      }),
      fallback,
    ),
  ).toBe('This device is already set up to sign in.')
  expect(
    passkeyProblem(
      new WebAuthnError({
        message: 'x',
        code: 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT',
        cause,
        name: 'ConstraintError',
      }),
      fallback,
    ),
  ).toBe(
    'This device cannot check your face, fingerprint or screen lock. Turn on a screen lock, then try again.',
  )
  expect(passkeyProblem(new ApiError('The password is incorrect.', 403), fallback)).toBe(
    'The password is incorrect.',
  )
  expect(passkeyProblem(new Error('SecurityError: odd'), fallback)).toBe(fallback)
})
