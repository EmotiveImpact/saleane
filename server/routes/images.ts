import { randomUUID } from 'node:crypto'
import { fail } from '../http'
import type { Context, Route } from '../context'
import type { LocalDatabase } from '../database'
import { can, operations, studioRole } from '../../src/domain/operations'
import type { Role } from '../../src/domain/operations'
import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, imageFacts } from '../images'

/**
 * Stage 2: product photos. Whoever may edit products adds one; the browser has already shrunk it.
 * The server reads what the bytes really are (JPEG, PNG or WebP, never SVG), refuses anything too
 * large, keeps it in the images table and returns the id the product keeps. Photos are served only
 * to signed-in staff of the same studio, never across studios, and never to a guest.
 */
export const IMAGE_BYTES_LIMIT = IMAGE_MAX_BYTES
export const IMAGE_TOO_LARGE = 'This photo is too large. Choose a smaller one.'
export const UPLOAD_PATH = /^\/api\/workspaces\/[^/]+\/images$/
export const IMAGE_PATH = /^\/api\/workspaces\/[^/]+\/images\/[^/]+$/
/** The most photos one studio keeps, counting ones not yet saved on a product. */
export const IMAGE_LIMIT = 1000
/** A photo added but never saved on a product is cleared away after a day. */
const UNUSED_FOR_MS = 24 * 60 * 60 * 1000
const ID = /^[A-Za-z0-9-]{8,64}$/

/** Whether a photo belongs to this studio, for a product command that names a new photo. */
export function imageBelongs(db: LocalDatabase, organisationId: string, imageId: string) {
  return !!db.get(
    "SELECT 1 AS found FROM images WHERE id=? AND organisation_id=? AND kind='product'",
    imageId,
    organisationId,
  )
}

export async function imageRoutes(ctx: Context, route: Route): Promise<boolean> {
  const { path, method, request, response, body, reply } = route
  if (path[0] !== 'api' || path[1] !== 'workspaces' || !path[2] || path[3] !== 'images')
    return false
  const { db, now, actorFor, orgFor, rateLimit } = ctx
  const orgId = path[2]

  if (path.length === 4 && method === 'POST') {
    const actor = actorFor(request, true)
    rateLimit(request, 'image-upload', 30, 60000)
    const org = orgFor(orgId, actor)
    if (!can(org.role, 'product')) fail(403, 'Your role cannot change products.')
    if (!(body instanceof Uint8Array) || !body.length) fail(400, 'Choose a photo to add.')
    const bytes = body as Uint8Array
    if (bytes.length > IMAGE_MAX_BYTES) fail(413, IMAGE_TOO_LARGE)
    const facts = imageFacts(bytes)
    if (!facts) fail(415, 'Choose a JPEG, PNG or WebP photo.')
    const { type, width, height } = facts!
    if (!width || !height) fail(415, 'This photo could not be read. Choose another.')
    if (width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE) fail(413, IMAGE_TOO_LARGE)
    const id = randomUUID()
    db.transaction(() => {
      // Photos added but never kept on a product are cleared away once they are a day old, read
      // against the studio as it is now, inside the same transaction as product changes.
      const current = orgFor(orgId, actor)
      const kept = new Set(
        operations(current.state)
          .products.map((p) => p.imageId)
          .filter(Boolean),
      )
      for (const row of db.all<{ id: string }>(
        'SELECT id FROM images WHERE organisation_id=? AND created_at<?',
        org.id,
        now() - UNUSED_FOR_MS,
      ))
        if (!kept.has(row.id)) db.run('DELETE FROM images WHERE id=?', row.id)
      const count = db.get<{ total: number }>(
        'SELECT count(*) AS total FROM images WHERE organisation_id=?',
        org.id,
      )!.total
      if (Number(count) >= IMAGE_LIMIT)
        fail(409, 'This studio has as many photos as it can keep. Remove some from products first.')
      db.run(
        'INSERT INTO images(id,organisation_id,kind,content_type,bytes,width,height,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)',
        id,
        org.id,
        'product',
        type,
        bytes,
        width,
        height,
        now(),
        actor.id,
      )
    })
    reply(201, { id, contentType: type, width, height })
    return true
  }

  if (path.length === 5 && method === 'GET') {
    const actor = actorFor(request)
    // A light check of who is asking, so a page of photos does not read the studio record each
    // time: the studio's own team only, never a practitioner's day or a regional manager's area.
    const member = db.get<{ role: Role }>(
      'SELECT role FROM memberships WHERE organisation_id=? AND account_id=?',
      orgId,
      actor.id,
    )
    if (!member) fail(404, 'That studio was not found.')
    if (!studioRole(member!.role)) fail(403, 'Product photos are for the studio team.')
    // A general manager whose location has closed is refused, as on every other route.
    if (member!.role === 'general') orgFor(orgId, actor)
    const imageId = path[4]
    const image = ID.test(imageId)
      ? db.get<{ content_type: string; bytes: Uint8Array }>(
          'SELECT content_type,bytes FROM images WHERE id=? AND organisation_id=?',
          imageId,
          orgId,
        )
      : undefined
    if (!image) fail(404, 'This photo was not found.')
    const bytes = image!.bytes
    response.statusCode = 200
    response.setHeader('Content-Type', image!.content_type)
    response.setHeader('Content-Length', String(bytes.length))
    // The id changes whenever the photo does, so the browser may keep it, for this person only.
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.end(bytes)
    return true
  }

  if (path.length === 4 || path.length === 5) fail(405, 'This photo address does not do that.')
  return false
}
