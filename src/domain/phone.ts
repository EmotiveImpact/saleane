import type { Region } from './model'

/**
 * Phone numbers as people write them. A guest booking online, or the desk noting a missed call,
 * types a number the way they know it: with its country code, or as a local number in the
 * studio's own country (07700 900123 in the UK, (212) 555-0100 in the US). SALEANE keeps it as
 * an international number, so texts and matching work the same whichever way it was typed.
 */

/** An international number (E.164, such as +447700900123), or null when it cannot be one. */
export function internationalNumber(region: Region, typed: string) {
  // "+44 (0)7700 900123" is a common way to write a UK number; the 0 is not dialled from abroad.
  const compact = typed.replace(/\(0\)/g, '').replace(/[\s().-]/g, '')
  // So is "+44 07700 900123", with the 0 kept by mistake.
  if (compact.startsWith('+')) return e164(compact.replace(/^\+440/, '+44'))
  if (compact.startsWith('00')) return e164(`+${compact.slice(2)}`.replace(/^\+440/, '+44'))
  if (!/^\d+$/.test(compact)) return null
  if (region === 'UK' && /^0\d{9,10}$/.test(compact)) return e164(`+44${compact.slice(1)}`)
  if (region === 'US') {
    if (/^\d{10}$/.test(compact)) return e164(`+1${compact}`)
    if (/^1\d{10}$/.test(compact)) return e164(`+${compact}`)
  }
  return null
}

function e164(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : null
}

/** A stored number spaced for reading: +44 7700 900123, +1 212 555 0100. */
export function numberLabel(number: string) {
  const uk = /^\+44(\d{4})(\d{6})$/.exec(number)
  if (uk) return `+44 ${uk[1]} ${uk[2]}`
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number)
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`
  return number
}

/** A guest's number as it is kept on their client record: international and spaced for reading. */
export function guestPhone(region: Region, typed: string) {
  const number = internationalNumber(region, typed)
  return number ? numberLabel(number) : null
}

/** What a guest is told when a number cannot be read, with examples from the studio's country. */
export function phoneProblem(region: Region) {
  return region === 'US'
    ? 'Enter a phone number we can reach you on, such as (212) 555-0142 or +1 212 555 0142.'
    : 'Enter a phone number we can reach you on, such as 07700 900456 or +44 7700 900456.'
}
