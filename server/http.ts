import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, Writable } from 'node:stream'

export const COOKIE = 'saleane_session'
export const SESSION_MS = 12 * 60 * 60 * 1000
const BODY_LIMIT = 64 * 1024

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    /** Stage 5: a short code for other software, on the access key API's refusals. */
    readonly code?: string,
  ) {
    super(message)
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message)
}
export type InjectOptions = {
  method?: string
  url: string
  headers?: Record<string, string>
  payload?: unknown
  remoteAddress?: string
  /** A body sent as it is: text, or bytes such as a photo. */
  rawPayload?: string | Uint8Array
}
export type InjectResponse = {
  statusCode: number
  headers: Record<string, string | string[]>
  body: string
  /** The body's bytes, for a response that is not text (a product photo). */
  rawBody: Buffer
  json: <T = Record<string, unknown>>() => T
}
type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

export function header(request: IncomingMessage, name: string) {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}
export function sessionToken(request: IncomingMessage): string | undefined {
  return header(request, 'cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
}
/** Reads a bounded body as JSON, or as text when `raw` is set (provider receipts). */
export async function readBody(request: IncomingMessage, raw = false): Promise<unknown> {
  const text = (await readBytes(request, BODY_LIMIT)).toString('utf8')
  if (raw) return text
  try {
    return JSON.parse(text)
  } catch {
    return fail(400, 'Use a valid JSON request.')
  }
}
/** Reads a bounded body as bytes (Stage 2: a product photo), refusing anything over `limit`. */
export async function readBytes(
  request: IncomingMessage,
  limit: number,
  tooLarge = 'This request is too large.',
): Promise<Buffer> {
  const length = Number(header(request, 'content-length'))
  if (Number.isFinite(length) && length > limit) {
    request.resume()
    fail(413, tooLarge)
  }
  if (header(request, 'content-encoding') && header(request, 'content-encoding') !== 'identity')
    fail(415, 'Encoded request bodies are not supported.')
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    let done = false
    const finish = (error?: Error, value?: Buffer) => {
      if (done) return
      done = true
      clearTimeout(timer)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
      if (error) {
        // Draining a rejected or aborted stream can emit a subsequent error.
        request.once('error', () => {})
        request.resume()
        reject(error)
      } else resolve(value!)
    }
    const onData = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += data.length
      if (size > limit) finish(new HttpError(413, tooLarge))
      else chunks.push(data)
    }
    const onEnd = () => finish(undefined, Buffer.concat(chunks))
    const onError = () => finish(new HttpError(400, 'The request could not be read.'))
    const onAborted = () => finish(new HttpError(400, 'The request was interrupted.'))
    const timer = setTimeout(() => finish(new HttpError(408, 'The request took too long.')), 10000)
    timer.unref()
    request.on('data', onData).on('end', onEnd).on('error', onError).on('aborted', onAborted)
  })
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export async function inject(
  handler: Handler,
  origin: string,
  input: InjectOptions,
): Promise<InjectResponse> {
  const method = input.method ?? 'GET'
  const payload =
    input.rawPayload ?? (input.payload === undefined ? '' : JSON.stringify(input.payload))
  const request = Readable.from(
    payload.length ? [Buffer.from(payload)] : [],
  ) as unknown as IncomingMessage
  Object.assign(request, {
    method,
    url: input.url,
    headers: {
      host: new URL(origin).host,
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
      ...Object.fromEntries(
        Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      ),
    },
    socket: { remoteAddress: input.remoteAddress ?? '127.0.0.1' },
  })
  const chunks: Buffer[] = [],
    headers: Record<string, string | string[]> = {}
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  }) as unknown as ServerResponse
  response.statusCode = 200
  response.setHeader = ((name: string, value: string | string[] | number) => {
    headers[name.toLowerCase()] = typeof value === 'number' ? String(value) : value
    return response
  }) as ServerResponse['setHeader']
  const finished = new Promise<void>((resolve) => response.on('finish', resolve))
  await handler(request, response)
  await finished
  const rawBody = Buffer.concat(chunks)
  const body = rawBody.toString('utf8')
  return {
    statusCode: response.statusCode,
    headers,
    body,
    rawBody,
    json: <T>() => JSON.parse(body) as T,
  }
}
