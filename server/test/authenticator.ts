import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

/**
 * NEXT-15: a pretend phone for tests. It makes passkeys and answers sign-in prompts the way a
 * real authenticator does (WebAuthn level 3, "none" attestation, ES256), so the server's checks
 * run against genuine signatures without a browser.
 */

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest()

/** Just enough CBOR for an attestation: maps, small and negative integers, bytes and text. */
function cbor(value: unknown): Buffer {
  const head = (major: number, length: number) => {
    if (length < 24) return Buffer.from([(major << 5) | length])
    if (length < 256) return Buffer.from([(major << 5) | 24, length])
    const out = Buffer.alloc(3)
    out[0] = (major << 5) | 25
    out.writeUInt16BE(length, 1)
    return out
  }
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8')
    return Buffer.concat([head(3, text.length), text])
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value])
  if (value instanceof Map)
    return Buffer.concat([
      head(5, value.size),
      ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]),
    ])
  throw new Error('Not encodable here.')
}

/** Flags in authenticator data: user present, user verified, backed up, attested credential. */
const FLAGS = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40 }

export type Prompt = { challenge: string; rp?: { id: string }; rpId?: string }

export class PretendPhone {
  readonly credentials = new Map<
    string,
    { key: KeyObject; userHandle: string; counter: number; rpID: string }
  >()
  constructor(
    /** The address the browser is on, which the device puts in every answer. */
    readonly origin: string,
    readonly options: { verifies?: boolean; synced?: boolean; counts?: boolean } = {},
  ) {}

  private authData(rpID: string, counter: number, extra = 0, attested?: Buffer) {
    let flags = FLAGS.up | extra
    if (this.options.verifies !== false) flags |= FLAGS.uv
    if (this.options.synced !== false) flags |= FLAGS.be | FLAGS.bs
    const count = Buffer.alloc(4)
    count.writeUInt32BE(counter)
    return Buffer.concat([sha256(rpID), Buffer.from([flags]), count, attested ?? Buffer.alloc(0)])
  }

  /** Answers `navigator.credentials.create` with a new passkey. */
  create(options: Prompt & { user: { id: string } }, overrides: { origin?: string } = {}) {
    const rpID = options.rp!.id
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const id = randomBytes(32)
    const jwk = publicKey.export({ format: 'jwk' })
    const cose = new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ])
    const length = Buffer.alloc(2)
    length.writeUInt16BE(id.length)
    const attested = Buffer.concat([Buffer.alloc(16), length, id, cbor(cose)])
    const authData = this.authData(rpID, 0, FLAGS.at, attested)
    const attestationObject = cbor(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    )
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin: overrides.origin ?? this.origin,
        crossOrigin: false,
      }),
    )
    this.credentials.set(b64(id), {
      key: privateKey,
      userHandle: options.user.id,
      counter: 0,
      rpID,
    })
    return {
      id: b64(id),
      rawId: b64(id),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
    }
  }

  /** Answers `navigator.credentials.get` with the named passkey, or the only one it holds. */
  get(options: Prompt, credentialId?: string, overrides: { counter?: number } = {}) {
    const id = credentialId ?? [...this.credentials.keys()][0]
    const held = this.credentials.get(id)
    if (!held) throw new Error('This pretend phone has no such passkey.')
    if (this.options.counts) held.counter += 1
    const counter = overrides.counter ?? held.counter
    const authData = this.authData(options.rpId ?? held.rpID, counter)
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    )
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), held.key)
    return {
      id,
      rawId: id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: held.userHandle,
      },
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
    }
  }
}
