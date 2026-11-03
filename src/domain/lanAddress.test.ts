import { describe, expect, it } from 'vitest'
import {
  lanAddress,
  parseIPv4,
  parseIPv6,
  printerHost,
  printerHostProblem,
  printerPortProblem,
} from './lanAddress'

// Stage 2: SALEANE only ever connects to a receipt printer on the studio's own network.
describe('addresses on the studio’s network', () => {
  it('accepts the private ranges, link-local and IPv6 unique-local', () => {
    for (const address of [
      '10.0.0.1',
      '10.255.255.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.50',
      '169.254.10.20',
      'fd00::1',
      'fc12:3456::9100',
      'fe80::1',
      'fe80::1%en0',
      '::ffff:192.168.1.50',
    ])
      expect(lanAddress(address), address).toBe(true)
  })

  it('refuses the internet, this computer and addresses meant for everyone', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.255.255',
      '172.32.0.1',
      '192.169.0.1',
      '127.0.0.1',
      '0.0.0.0',
      '255.255.255.255',
      '224.0.0.1',
      '100.64.0.1',
      '::1',
      '::',
      '2001:db8::1',
      '2a00:1450::200e',
      '::ffff:8.8.8.8',
      '::ffff:127.0.0.1',
      'fd00::1%en0',
      'ff02::1',
    ])
      expect(lanAddress(address), address).toBe(false)
  })

  it('refuses addresses written in an unusual way, which some systems read differently', () => {
    for (const odd of [
      '3232235826', // 192.168.1.50 as one number
      '0xC0A80132',
      '0xc0.0xa8.1.50',
      '0300.0250.01.062', // octal
      '192.168.010.5', // a leading zero
      '192.168.1', // too few parts
      '192.168.1.50.1',
      '192.168.1.256',
      '1e2.0.0.1',
      ' 192.168.1.50 x',
    ]) {
      expect(parseIPv4(odd), odd).toBeNull()
      expect(lanAddress(odd), odd).toBe(false)
      expect(printerHostProblem(odd), odd).not.toBeNull()
    }
    expect(printerHostProblem('3232235826')).toBe(
      'Write the printer’s address the usual way, with four numbers, such as 192.168.1.50.',
    )
    expect(printerHostProblem('0xC0A80132')).toMatch(/the usual way/)
    expect(parseIPv6('fd00::1::2')).toBeNull()
    expect(parseIPv6('fd00:::1')).toBeNull()
    expect(parseIPv6('fd00::12345')).toBeNull()
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull()
  })

  it('says why a printer address cannot be used', () => {
    expect(printerHostProblem('')).toBe(
      'Enter the printer’s address on your network, such as 192.168.1.50.',
    )
    expect(printerHostProblem('8.8.8.8')).toBe(
      'SALEANE only connects to a printer on your own network, such as 192.168.1.50.',
    )
    expect(printerHostProblem('127.0.0.1')).toMatch(/your own network/)
    expect(printerHostProblem('localhost')).toBe(
      'That is this computer, not a printer. Enter the printer’s own address.',
    )
    expect(printerHostProblem('printer.localhost')).toMatch(/this computer/)
    expect(printerHostProblem('bad name!')).toMatch(/printer’s name on your network/)
    expect(printerHostProblem('a..b')).not.toBeNull()
    // A name is allowed here; the server looks it up and checks where it leads.
    expect(printerHostProblem('receipts.local')).toBeNull()
    expect(printerHostProblem('EPSON-TM-T20')).toBeNull()
    expect(printerHostProblem(' 192.168.1.50 ')).toBeNull()
    expect(printerHostProblem('[fd00::1]')).toBeNull()
    expect(printerHost(' [fd00::1] ')).toBe('fd00::1')
  })

  it('keeps to the ports receipt printers take print jobs on', () => {
    expect(printerPortProblem(9100)).toBeNull()
    expect(printerPortProblem(9109)).toBeNull()
    for (const port of [80, 22, 6379, 9099, 9110, 65535, 9100.5])
      expect(printerPortProblem(port), String(port)).toBe(
        'Receipt printers take print jobs on port 9100. Use a port from 9100 to 9109.',
      )
  })
})
