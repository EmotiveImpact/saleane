import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4, for Amazon SES. Written from AWS's published description and checked
 * against its published examples (server/messaging/aws.test.ts), so SALEANE needs no AWS library.
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */
export type AwsKeys = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value, 'utf8').digest()
/** RFC 3986 encoding, which AWS asks for: encodeURIComponent leaves !'()* alone. */
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/** The headers to add to a request so AWS accepts it: Authorization, X-Amz-Date and any token. */
export function signAws(request: {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  region: string
  service: string
  keys: AwsKeys
  now: Date
}): Record<string, string> {
  const url = new URL(request.url)
  const amzDate = request.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const day = amzDate.slice(0, 8)
  const added: Record<string, string> = { 'X-Amz-Date': amzDate }
  if (request.keys.sessionToken) added['X-Amz-Security-Token'] = request.keys.sessionToken
  const all: Record<string, string> = { host: url.host, ...request.headers, ...added }
  const headers = new Map<string, string>()
  for (const [name, value] of Object.entries(all))
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, ' '))
  const names = [...headers.keys()].sort()
  const signedHeaders = names.join(';')
  const path =
    url.pathname
      .split('/')
      .map((segment) => encode(decodeURIComponent(segment)))
      .join('/') || '/'
  const query = [...url.searchParams.entries()]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const canonical = [
    request.method.toUpperCase(),
    path,
    query,
    names.map((name) => `${name}:${headers.get(name)}\n`).join(''),
    signedHeaders,
    hash(request.body),
  ].join('\n')
  const scope = `${day}/${request.region}/${request.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonical)].join('\n')
  const key = hmac(
    hmac(hmac(hmac(`AWS4${request.keys.secretAccessKey}`, day), request.region), request.service),
    'aws4_request',
  )
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex')
  return {
    ...added,
    Authorization: `AWS4-HMAC-SHA256 Credential=${request.keys.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
