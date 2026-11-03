// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiHandler } from './app'
import type { ApiHandler, InjectResponse } from './app'
import { backupDatabase, restoreDatabase } from './backup'
import { LocalDatabase } from './database'
import { imageFacts } from './images'
import type { BusinessState } from '../src/domain/model'
import type { Command } from '../src/domain/commands'

// Stage 2: product photos and barcodes. Photos are checked by their first bytes, bounded in size,
// added only by people who may edit products, and served only to the same studio's team.
const origin = 'http://127.0.0.1:5173'
const password = 'Fictional local account 2026!'
type Login = { cookie: string; csrf: string; orgId: string }
let api: ApiHandler
const clock = Date.parse('2026-10-06T08:00:00.000Z')

beforeEach(() => {
  api = createApiHandler({ origin, databasePath: ':memory:', now: () => clock })
})
afterEach(() => api.close())

/** A PNG header: the signature and the IHDR chunk with its width and height. */
function png(width = 640, height = 480, size = 64) {
  const bytes = new Uint8Array(Math.max(size, 33))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  bytes.set(
    [...'IHDR'].map((c) => c.charCodeAt(0)),
    12,
  )
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
/** A JPEG with an APP0 segment, then a start-of-frame segment carrying its size. */
function jpeg(width = 800, height = 600) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3]
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...new Array(20).fill(0), 0xff, 0xd9])
}
/** A WebP whose extended header (VP8X) gives the canvas size. */
function webp(width = 800, height = 800) {
  const bytes = new Uint8Array(40)
  const text = (at: number, value: string) =>
    bytes.set(
      [...value].map((c) => c.charCodeAt(0)),
      at,
    )
  text(0, 'RIFF')
  text(8, 'WEBP')
  text(12, 'VP8X')
  bytes[16] = 10
  const w = width - 1,
    h = height - 1
  bytes.set(
    [w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255],
    24,
  )
  return bytes
}
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
)

const headers = (login: Login) => ({ cookie: login.cookie, 'x-csrf-token': login.csrf })
const cookie = (response: InjectResponse) => String(response.headers['set-cookie']).split(';')[0]
async function register(email: string, invitation?: string, name = 'Studio Owner') {
  const response = await api.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name,
      email,
      password,
      ...(invitation
        ? { invitation }
        : {
            workspace: { name: 'Photo Studio', locationName: 'London', region: 'UK', sample: true },
          }),
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  return { ...response.json<{ csrf: string; orgId: string }>(), cookie: cookie(response) }
}
const upload = (
  login: Login,
  bytes: Uint8Array,
  type = 'image/png',
  extra: Record<string, string> = {},
  orgId = login.orgId,
) =>
  api.inject({
    method: 'POST',
    url: `/api/workspaces/${orgId}/images`,
    headers: { ...headers(login), 'content-type': type, ...extra },
    rawPayload: bytes,
  })
const photo = (login: Login, id: string, orgId = login.orgId) =>
  api.inject({ url: `/api/workspaces/${orgId}/images/${id}`, headers: { cookie: login.cookie } })
const studio = async (login: Login) =>
  (await api.inject({ url: `/api/workspaces/${login.orgId}`, headers: headers(login) })).json<{
    state: BusinessState
  }>().state
async function run(login: Login, command: Command, owner = login) {
  const { revision } = await studio(owner)
  return api.inject({
    method: 'POST',
    url: `/api/workspaces/${login.orgId}/commands`,
    headers: { ...headers(login), 'idempotency-key': crypto.randomUUID() },
    payload: { revision, command },
  })
}
async function member(
  owner: Login,
  email: string,
  role: string,
  extra: Record<string, string> = {},
) {
  const invitation = await api.inject({
    method: 'POST',
    url: `/api/workspaces/${owner.orgId}/invitations`,
    headers: headers(owner),
    payload: { email, role, ...extra },
  })
  expect(invitation.statusCode, invitation.body).toBe(201)
  const login = await register(email, invitation.json<{ invitation: string }>().invitation)
  return { ...login, orgId: owner.orgId }
}
/** The sample serum, with its photo or barcode changed and everything else kept. */
async function serumWith(login: Login, patch: { imageId?: string; barcode?: string }) {
  const serum = (await studio(login)).operations!.products.find(
    (p) => p.id === 'product-hydrating-serum',
  )!
  const { id, ...input } = serum
  return { type: 'product', id, input: { ...input, ...patch } } as Command
}

describe('reading a photo’s own bytes', () => {
  it('knows JPEG, PNG and WebP and their sizes, from the bytes alone', () => {
    expect(imageFacts(png(640, 480))).toEqual({ type: 'image/png', width: 640, height: 480 })
    expect(imageFacts(jpeg(800, 600))).toEqual({ type: 'image/jpeg', width: 800, height: 600 })
    expect(imageFacts(webp(800, 533))).toEqual({ type: 'image/webp', width: 800, height: 533 })
  })
  it('refuses SVG, GIF, HTML and truncated files', () => {
    expect(imageFacts(svg)).toBeNull()
    expect(imageFacts(new TextEncoder().encode('GIF89a\x01\x00\x01\x00'))).toBeNull()
    expect(imageFacts(new TextEncoder().encode('<!doctype html><p>hello</p>'))).toBeNull()
    expect(imageFacts(jpeg().slice(0, 12))).toBeNull()
    expect(imageFacts(new Uint8Array())).toBeNull()
  })
})

describe('product photos on the server', () => {
  it('lets the owner add a photo and serves it to the team with a long private cache', async () => {
    const owner = await register('owner@example.invalid')
    const added = await upload(owner, webp(), 'image/webp')
    expect(added.statusCode, added.body).toBe(201)
    const { id, width, height, contentType } = added.json<{
      id: string
      width: number
      height: number
      contentType: string
    }>()
    expect({ width, height, contentType }).toEqual({
      width: 800,
      height: 800,
      contentType: 'image/webp',
    })
    const served = await photo(owner, id)
    expect(served.statusCode).toBe(200)
    expect(served.headers['content-type']).toBe('image/webp')
    expect(served.headers['x-content-type-options']).toBe('nosniff')
    expect(served.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect([...served.rawBody]).toEqual([...webp()])

    // The product keeps the photo's id; the change record says the photo changed.
    const saved = await run(owner, await serumWith(owner, { imageId: id }))
    expect(saved.statusCode, saved.body).toBe(200)
    const serum = (await studio(owner)).operations!.products.find(
      (p) => p.id === 'product-hydrating-serum',
    )!
    expect(serum.imageId).toBe(id)
    // Removing the photo keeps the product and clears its id.
    const { imageId: _removed, ...rest } = serum
    void _removed
    const { id: productId, ...input } = rest
    const removed = await run(owner, { type: 'product', id: productId, input } as Command)
    expect(removed.statusCode, removed.body).toBe(200)
    expect(
      (await studio(owner)).operations!.products.find((p) => p.id === productId)!.imageId,
    ).toBeUndefined()
  })

  it('checks the type by the first bytes, never trusting the name or the stated type', async () => {
    const owner = await register('owner@example.invalid')
    for (const [bytes, type] of [
      [svg, 'image/png'],
      [svg, 'image/jpeg'],
      [new TextEncoder().encode('GIF89a\x01\x00\x01\x00;;;;;;;;;;;;;;;;;;;;'), 'image/webp'],
    ] as const) {
      const refused = await upload(owner, bytes, type)
      expect(refused.statusCode).toBe(415)
      expect(refused.json().error).toBe('Choose a JPEG, PNG or WebP photo.')
    }
    const named = await upload(owner, svg, 'image/svg+xml')
    expect(named.statusCode).toBe(415)
    // A photo sent with another photo type is kept as what its bytes say it is.
    const jpegAsPng = await upload(owner, jpeg(), 'image/png')
    expect(jpegAsPng.statusCode, jpegAsPng.body).toBe(201)
    expect(jpegAsPng.json().contentType).toBe('image/jpeg')
    const served = await photo(owner, jpegAsPng.json<{ id: string }>().id)
    expect(served.headers['content-type']).toBe('image/jpeg')
  })

  it('refuses a photo over 400 KB, or larger than 2000 pixels on a side', async () => {
    const owner = await register('owner@example.invalid')
    const large = await upload(owner, png(800, 800, 400 * 1024 + 1))
    expect(large.statusCode).toBe(413)
    expect(large.json().error).toBe('This photo is too large. Choose a smaller one.')
    // Even when the stated length is missing, the bytes are counted as they arrive.
    const counted = await upload(owner, png(800, 800, 400 * 1024 + 1), 'image/png', {
      'content-length': '100',
    })
    expect(counted.statusCode).toBe(413)
    const wide = await upload(owner, png(2001, 600))
    expect(wide.statusCode).toBe(413)
    expect((await upload(owner, png(800, 800, 400 * 1024))).statusCode).toBe(201)
    expect((await upload(owner, new Uint8Array())).statusCode).toBe(400)
  })

  it('needs the session’s request token and the studio’s own address', async () => {
    const owner = await register('owner@example.invalid')
    const tokenless = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/images`,
      headers: { cookie: owner.cookie, 'content-type': 'image/png' },
      rawPayload: png(),
    })
    expect(tokenless.statusCode).toBe(403)
    const elsewhere = await upload(owner, png(), 'image/png', {
      origin: 'https://elsewhere.example',
    })
    expect(elsewhere.statusCode).toBe(403)
    const signedOut = await api.inject({ url: `/api/workspaces/${owner.orgId}/images/x1234567` })
    expect(signedOut.statusCode).toBe(401)
  })

  it('lets only those who may edit products add photos, and shows them to the studio team only', async () => {
    const owner = await register('owner@example.invalid')
    const id = (await upload(owner, png())).json<{ id: string }>().id
    const manager = await member(owner, 'manager@example.invalid', 'manager')
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const practitioner = await member(owner, 'maya@example.invalid', 'practitioner', {
      staffId: 'staff-maya',
    })
    expect((await upload(manager, png())).statusCode).toBe(201)
    const deskUpload = await upload(desk, png())
    expect(deskUpload.statusCode).toBe(403)
    expect(deskUpload.json().error).toBe('Your role cannot change products.')
    expect((await upload(practitioner, png())).statusCode).toBe(403)
    // The desk sees product photos where it sells products; a practitioner's day has no products.
    expect((await photo(desk, id)).statusCode).toBe(200)
    expect((await photo(manager, id)).statusCode).toBe(200)
    expect((await photo(practitioner, id)).statusCode).toBe(403)
    // The desk cannot attach a photo to a product either: the product command is refused.
    expect((await run(desk, await serumWith(owner, { imageId: id }), owner)).statusCode).toBe(403)
  })

  it('treats a general manager as today: no product changes, but the photos are visible', async () => {
    const owner = await register('owner@example.invalid')
    const id = (await upload(owner, png())).json<{ id: string }>().id
    let state = await studio(owner)
    const added = await api.inject({
      method: 'POST',
      url: `/api/workspaces/${owner.orgId}/commands`,
      headers: { ...headers(owner), 'idempotency-key': crypto.randomUUID() },
      payload: {
        revision: state.revision,
        command: { type: 'location', input: { name: 'Islington', address: '1 Upper Street' } },
      },
    })
    expect(added.statusCode, added.body).toBe(200)
    state = await studio(owner)
    const general = await member(owner, 'general@example.invalid', 'general', {
      locationId: state.operations!.locations![0].id,
    })
    expect((await upload(general, png())).statusCode).toBe(403)
    expect((await photo(general, id)).statusCode).toBe(200)
  })

  it('never serves or attaches another studio’s photo', async () => {
    const first = await register('first@example.invalid')
    const second = await register('second@example.invalid')
    const id = (await upload(first, png())).json<{ id: string }>().id
    // Asking through the other studio's address: that studio has no such photo.
    expect((await photo(second, id, second.orgId)).statusCode).toBe(404)
    // Asking through the first studio's address: not a member there.
    expect((await photo(second, id, first.orgId)).statusCode).toBe(404)
    expect((await upload(second, png(), 'image/png', {}, first.orgId)).statusCode).toBe(404)
    const attached = await run(second, await serumWith(second, { imageId: id }))
    expect(attached.statusCode).toBe(422)
    expect(attached.json().error).toBe('That photo could not be found. Add it again.')
    const unknown = await run(second, await serumWith(second, { imageId: 'not-a-real-photo' }))
    expect(unknown.statusCode).toBe(422)
  })

  it('clears away photos never kept on a product once they are a day old', async () => {
    const owner = await register('owner@example.invalid')
    const kept = (await upload(owner, png())).json<{ id: string }>().id
    const unused = (await upload(owner, png())).json<{ id: string }>().id
    expect((await run(owner, await serumWith(owner, { imageId: kept }))).statusCode).toBe(200)
    // Both were added more than a day ago (sessions last 12 hours, so the clock stays put).
    api.database.run(
      'UPDATE images SET created_at=? WHERE id IN (?,?)',
      clock - 25 * 60 * 60 * 1000,
      kept,
      unused,
    )
    const fresh = (await upload(owner, png())).json<{ id: string }>().id
    expect((await photo(owner, kept)).statusCode).toBe(200)
    expect((await photo(owner, fresh)).statusCode).toBe(200)
    expect((await photo(owner, unused)).statusCode).toBe(404)
  })
})

describe('barcodes on the server', () => {
  it('refuses a barcode another product already has, naming that product', async () => {
    const owner = await register('owner@example.invalid')
    const taken = await run(owner, {
      type: 'product',
      input: {
        name: 'Rose Toner',
        sku: '',
        priceMinor: 2200,
        reorderAt: 2,
        archived: false,
        barcode: '2000000000022',
      },
    })
    expect(taken.statusCode).toBe(422)
    expect(taken.json().error).toBe(
      'Hydrating Serum already has barcode 2000000000022. Each barcode belongs to one product.',
    )
    const wrong = await run(owner, await serumWith(owner, { barcode: '5012345678901' }))
    expect(wrong.statusCode).toBe(422)
    expect(wrong.json().error).toContain('For this one it should be 0, not 1.')
    const changed = await run(owner, await serumWith(owner, { barcode: ' 5 012345 678900 ' }))
    expect(changed.statusCode, changed.body).toBe(200)
    const serum = (await studio(owner)).operations!.products.find(
      (p) => p.id === 'product-hydrating-serum',
    )!
    expect(serum.barcode).toBe('5012345678900')
  })

  it('lets only those who may edit products change a barcode', async () => {
    const owner = await register('owner@example.invalid')
    const desk = await member(owner, 'desk@example.invalid', 'reception')
    const refused = await run(desk, await serumWith(owner, { barcode: '5012345678900' }), owner)
    expect(refused.statusCode).toBe(403)
  })
})

describe('backups', () => {
  it('copies photos with the rest of the database and restores them', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'saleane-images-backup-'))
    try {
      api.close()
      api = createApiHandler({ origin, databasePath: join(directory, 'source.sqlite') })
      const owner = await register('owner@example.invalid')
      const id = (await upload(owner, webp(), 'image/webp')).json<{ id: string }>().id
      backupDatabase(join(directory, 'source.sqlite'), join(directory, 'copy.sqlite'))
      restoreDatabase(join(directory, 'copy.sqlite'), join(directory, 'restored.sqlite'))
      const restored = new LocalDatabase(join(directory, 'restored.sqlite'))
      const row = restored.get<{ content_type: string; bytes: Uint8Array }>(
        'SELECT content_type,bytes FROM images WHERE id=?',
        id,
      )
      expect(row?.content_type).toBe('image/webp')
      expect([...row!.bytes]).toEqual([...webp()])
      restored.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
