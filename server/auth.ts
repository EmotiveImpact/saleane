import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt=promisify(derive)
export const token=()=>randomBytes(32).toString('base64url')
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
export async function passwordHash(password:string) {
  const salt=randomBytes(16).toString('hex')
  const hash=await scrypt(password,salt,64) as Buffer
  return `scrypt:${salt}:${hash.toString('hex')}`
}
export async function checkPassword(password:string,encoded:string) {
  const [,salt,hash]=encoded.split(':')
  if(!salt||!hash)return false
  const actual=await scrypt(password,salt,64) as Buffer
  const expected=Buffer.from(hash,'hex')
  return actual.length===expected.length&&timingSafeEqual(actual,expected)
}
