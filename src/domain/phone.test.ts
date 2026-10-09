import { describe, expect, it } from 'vitest'
import { guestPhone, internationalNumber, numberLabel, phoneProblem } from './phone'

describe('phone numbers as guests write them', () => {
  it('reads UK numbers written the local way, with spaces, brackets or dashes', () => {
    for (const typed of [
      '07700 900456',
      '07700900456',
      '(07700) 900-456',
      '07700.900.456',
      '+44 7700 900456',
      '+44 (0)7700 900456',
      '+44 07700 900456',
      '0044 7700 900456',
    ])
      expect(internationalNumber('UK', typed), typed).toBe('+447700900456')
    expect(internationalNumber('UK', '020 7946 0000')).toBe('+442079460000')
  })

  it('reads US numbers written the local way', () => {
    for (const typed of ['(212) 555-0142', '212-555-0142', '212.555.0142', '1 212 555 0142'])
      expect(internationalNumber('US', typed), typed).toBe('+12125550142')
    expect(internationalNumber('US', '+1 (212) 555-0142')).toBe('+12125550142')
  })

  it('reads a number with its country code wherever the studio is', () => {
    expect(internationalNumber('UK', '+1 212 555 0142')).toBe('+12125550142')
    expect(internationalNumber('US', '+44 7700 900456')).toBe('+447700900456')
    expect(internationalNumber('UK', '+33 6 12 34 56 78')).toBe('+33612345678')
  })

  it('refuses rubbish, and local numbers from another country', () => {
    for (const typed of [
      '',
      'call me',
      '12345',
      '07700',
      '+44',
      '0770090045612345',
      '07700 9004a6',
    ])
      expect(internationalNumber('UK', typed), typed).toBeNull()
    expect(internationalNumber('UK', '(212) 555-0142')).toBeNull()
    expect(internationalNumber('US', '07700 900456')).toBeNull()
  })

  it('keeps a guest number international and spaced for reading', () => {
    expect(guestPhone('UK', '07700 900456')).toBe('+44 7700 900456')
    expect(guestPhone('US', '(212) 555-0142')).toBe('+1 212 555 0142')
    expect(guestPhone('UK', '+33 6 12 34 56 78')).toBe('+33612345678')
    expect(guestPhone('UK', 'rubbish')).toBeNull()
    expect(numberLabel('+447700900456')).toBe('+44 7700 900456')
  })

  it('says what to type with examples from the studio’s own country', () => {
    expect(phoneProblem('UK')).toContain('07700 900456')
    expect(phoneProblem('US')).toContain('(212) 555-0142')
  })
})
