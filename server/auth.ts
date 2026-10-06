import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export const token = () => randomBytes(32).toString('base64url')
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await derive(password, salt)
  return `scrypt:32768:8:1:${salt}:${derived.toString('hex')}`
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, value) => {
        if (error) reject(error)
        else resolve(value)
      },
    )
  })
}

export async function checkPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(':')
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join(':') !== 'scrypt:32768:8:1' ||
    !/^[a-f0-9]{32}$/.test(parts[4]) ||
    !/^[a-f0-9]{128}$/.test(parts[5])
  )
    return false
  const actual = await derive(password, parts[4])
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex'))
}

export function equalToken(actual: string | undefined, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false
  const received = Buffer.from(actual),
    wanted = Buffer.from(expected)
  return received.length === wanted.length && timingSafeEqual(received, wanted)
}
