import { z } from 'zod'
import type { Region } from './model'

/**
 * How guests reach a studio: its phone number and email address, kept as the studio typed them.
 * A phone number may be in the studio's local form ("020 7946 0123", "(212) 555-0123") or in
 * international form with a country code ("+44 20 7946 0123").
 */
const PHONE_CHARACTERS = /^\+?[\d\s().-]+$/

const examples: Record<Region, string> = {
  UK: '020 7946 0123 or +44 20 7946 0123',
  US: '(212) 555-0123 or +1 212 555 0123',
}

/** The digits a guest dials. "+44 (0)20" is written that way but dialled without the 0. */
const dialled = (phone: string) =>
  phone
    .trim()
    .replace(/^(\+\d{1,3})\s*\(0\)/, '$1')
    .replace(/\D/g, '')

/** Why a studio phone number would not work for guests, or null when it would. */
export function phoneProblem(phone: string, region: Region) {
  const value = phone.trim()
  const digits = dialled(value)
  const valid = !PHONE_CHARACTERS.test(value)
    ? false
    : value.startsWith('+')
      ? /^[1-9]\d{7,14}$/.test(digits)
      : region === 'UK'
        ? /^0\d{9,10}$/.test(digits)
        : /^1?[2-9]\d{2}[2-9]\d{6}$/.test(digits)
  return valid ? null : `Enter the phone number as guests would dial it, like ${examples[region]}.`
}

/** Why a studio email address would not work for guests, or null when it would. */
export function emailProblem(email: string) {
  return z.email().max(254).safeParse(email.trim()).success
    ? null
    : 'Enter the email address in full, like hello@yourstudio.com.'
}

/** A tap-to-call link that works from anywhere: a local number gains its country code. */
export function phoneLink(phone: string, region: Region) {
  const digits = dialled(phone)
  if (phone.trim().startsWith('+')) return `tel:+${digits}`
  if (region === 'UK') return `tel:+44${digits.replace(/^0/, '')}`
  return `tel:+${digits.length === 10 ? `1${digits}` : digits}`
}

/** A maps search for the address, opened in the guest's own maps app or browser. */
export function directionsLink(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`
}
