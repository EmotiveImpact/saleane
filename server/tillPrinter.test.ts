// @vitest-environment node
import { createServer } from 'node:net'
import type { Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { Receipt } from '../src/domain/receipt'
import { lanAddress } from '../src/domain/lanAddress'
import {
  DRAWER_PULSE,
  columns,
  drawerJob,
  encode,
  fromHex,
  preview,
  receiptJob,
  testPageJob,
  toHex,
  wrap,
} from './till/escpos'
import { networkPrinter, testPrinter } from './till/printers'

// Stage 2: the receipt printer's language, and reaching a printer on the studio's network only.
const simple: Receipt = {
  ref: { kind: 'walk-in', id: 'c-1' },
  key: 'walk-in:c-1',
  kind: 'walk-in',
  title: 'Receipt',
  number: 'SC-7',
  locationId: 'loc-1',
  studio: { name: 'Lumen', address: '1 High St' },
  issuedAt: '2026-10-06T13:05:00.000Z',
  date: 'Tuesday 6 October 2026',
  time: '14:05',
  servedBy: 'Maya',
  lines: [{ label: 'Balm', amountMinor: 1250 }],
  totalMinor: 1250,
  included: [{ label: 'Includes VAT 20%', amountMinor: 208 }],
  settled: [],
  paid: { label: 'Cash', amountMinor: 1250 },
  refunds: [],
  notes: [],
  thanks: 'Thank you.',
  sample: false,
  money: { locale: 'en-GB', currency: 'GBP' },
}
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const line = (text: string) => [...ascii(text), 0x0a]
/** "Balm" on the left and "£12.50" on the right of a 32-character line (£ is one byte). */
const pair = (label: string, amount: string) => [
  ...ascii(label.padEnd(32 - 1 - amount.length)),
  0x9c,
  ...ascii(amount),
  0x0a,
]

describe('ESC/POS', () => {
  it('writes a simple receipt as exactly these bytes (golden)', () => {
    const rule = line('-'.repeat(32))
    const golden = [
      ...[0x1b, 0x40], // reset
      ...[0x1b, 0x74, 0x13], // code page PC858, which has £
      ...[0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01, 0x1d, 0x21, 0x11], // centred, bold, double size
      ...line('Lumen'),
      ...[0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00], // normal size, not bold
      ...line('1 High St'),
      ...[0x1b, 0x61, 0x00], // left
      0x0a,
      ...line('Receipt SC-7'),
      ...line('Tuesday 6 October 2026, 14:05'),
      ...line('Served by Maya'),
      ...rule,
      ...pair('Balm', '12.50'),
      ...rule,
      ...[0x1b, 0x45, 0x01],
      ...pair('Total', '12.50'),
      ...[0x1b, 0x45, 0x00],
      ...pair('Includes VAT 20%', '2.08'),
      ...pair('Paid: Cash', '12.50'),
      ...rule,
      ...[0x1b, 0x61, 0x01],
      ...line('Thank you.'),
      ...[0x1b, 0x61, 0x00],
      ...[0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00], // feed four lines, then cut
    ]
    expect(toHex(receiptJob(simple, '58'))).toBe(toHex(Uint8Array.from(golden)))
  })

  it('reads a job back as the paper would look, for the test printer’s preview', () => {
    const shown = preview(receiptJob(simple, '80'))
    expect(shown.cut).toBe(true)
    expect(shown.drawer).toBe(false)
    expect(shown.lines[0]).toEqual({ text: 'Lumen', bold: true, centre: true, large: true })
    expect(shown.lines.find((l) => l.text.startsWith('Total'))).toEqual({
      text: `Total${' '.repeat(48 - 5 - 6)}£12.50`,
      bold: true,
    })
    expect(shown.lines.at(-1)).toEqual({ text: 'Thank you.', centre: true })
    expect(preview(receiptJob(simple, '80', { drawer: true })).drawer).toBe(true)
    expect(preview(drawerJob())).toEqual({ lines: [], cut: false, drawer: true })
    expect([...drawerJob()]).toEqual([0x1b, 0x40, ...DRAWER_PULSE])
    expect(preview(fromHex(toHex(testPageJob('Lumen', 'Islington', '58')))).lines[0]).toEqual({
      text: 'Lumen',
      bold: true,
      centre: true,
    })
  })

  it('never lets typed text become a printer command, and writes £ and accents properly', () => {
    expect(encode('Café £5 €2 Zoë')).toEqual([
      ...ascii('Caf'),
      0x82,
      ...ascii(' '),
      0x9c,
      ...ascii('5 '),
      0xd5,
      ...ascii('2 Zo'),
      0x89,
    ])
    // ESC, a line feed and other control characters turn into a question mark or a space.
    expect(encode('a\x1bp\x00\x19b\nc')).toEqual(ascii('a?p??b c'))
    expect(encode('studio’s \u2013 “best” \u2014 − 5 …')).toEqual(
      ascii('studio\'s - "best" - - 5 ...'),
    )
    expect(encode('Łukasz 中')).toEqual(ascii('?ukasz ?'))
    expect(String.fromCharCode(...encode('9:30 PM'))).toBe('9:30 PM')
    // "á" is byte 0xA0, which JavaScript treats as a space: it must not split a word.
    expect(wrap(String.fromCharCode(...encode('Ana María')), 32)).toEqual([
      String.fromCharCode(...encode('Ana María')),
    ])
    expect(columns('A very long product name that needs two lines', '£10.00', 32)).toEqual([
      'A very long product name',
      `that needs two lines${' '.repeat(32 - 20 - 6)}${String.fromCharCode(0x9c)}10.00`,
    ])
  })
})

describe('reaching a printer', () => {
  let server: Server | undefined
  afterEach(() => server?.close())
  /** A pretend receipt printer on this computer, on the first free printer port. */
  async function listen() {
    const received: Buffer[] = []
    for (let port = 9100; port <= 9109; port++) {
      const candidate = createServer((socket) => {
        socket.on('data', (chunk: Buffer) => received.push(chunk))
      })
      const ok = await new Promise<boolean>((resolve) => {
        candidate.once('error', () => resolve(false))
        candidate.listen(port, '127.0.0.1', () => resolve(true))
      })
      if (ok) {
        server = candidate
        return { port, received }
      }
    }
    throw new Error('No printer port free for the test.')
  }
  const settle = (received: Buffer[], length: number) =>
    new Promise<Buffer>((resolve) => {
      const check = () => {
        const all = Buffer.concat(received)
        if (all.length >= length) resolve(all)
        else setTimeout(check, 5)
      }
      check()
    })
  // Only these tests may reach this computer, standing in for the studio's network.
  const lanOrHere = (address: string) => lanAddress(address) || address === '127.0.0.1'

  it('sends the job over TCP and says it was sent, never that it printed', async () => {
    const { port, received } = await listen()
    const bytes = receiptJob(simple, '80')
    const outcome = await networkPrinter({ allow: lanOrHere }).send({
      host: '127.0.0.1',
      port,
      bytes,
    })
    expect(outcome).toEqual({ ok: true })
    expect(toHex(await settle(received, bytes.length))).toBe(toHex(bytes))
  })

  it('looks a printer’s name up and connects to the address it checked', async () => {
    const { port, received } = await listen()
    const looked: string[] = []
    const printer = networkPrinter({
      allow: lanOrHere,
      lookup: async (host) => {
        looked.push(host)
        return [{ address: '127.0.0.1' }]
      },
    })
    expect(await printer.send({ host: 'receipts.local', port, bytes: drawerJob() })).toEqual({
      ok: true,
    })
    expect(looked).toEqual(['receipts.local'])
    expect([...(await settle(received, 7))]).toEqual([0x1b, 0x40, ...DRAWER_PULSE])
  })

  it('refuses this computer, the internet, names that lead there, and odd addresses', async () => {
    const { port, received } = await listen()
    const real = networkPrinter()
    expect(await real.send({ host: '127.0.0.1', port, bytes: drawerJob() })).toEqual({
      ok: false,
      detail: 'SALEANE only connects to a printer on your own network, such as 192.168.1.50.',
    })
    expect(await real.send({ host: '8.8.8.8', port: 9100, bytes: drawerJob() })).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/your own network/),
    })
    const publicName = networkPrinter({ lookup: async () => [{ address: '93.184.216.34' }] })
    expect(
      await publicName.send({ host: 'printer.example.com', port: 9100, bytes: drawerJob() }),
    ).toEqual({
      ok: false,
      detail:
        'printer.example.com leads outside the studio’s network, so SALEANE did not connect to it.',
    })
    // One private answer and one public one is still refused.
    const mixed = networkPrinter({
      lookup: async () => [{ address: '192.168.1.50' }, { address: '8.8.4.4' }],
    })
    expect((await mixed.send({ host: 'printer.lan', port: 9100, bytes: drawerJob() })).ok).toBe(
      false,
    )
    const neverLooked = networkPrinter({
      lookup: async () => {
        throw new Error('An odd address must not be looked up.')
      },
    })
    for (const host of ['3232235826', '0xC0A80132', '0300.0250.01.062', '192.168.1', 'localhost'])
      expect((await neverLooked.send({ host, port: 9100, bytes: drawerJob() })).ok, host).toBe(
        false,
      )
    expect(await real.send({ host: '192.168.1.50', port: 6379, bytes: drawerJob() })).toEqual({
      ok: false,
      detail: 'Receipt printers take print jobs on port 9100. Use a port from 9100 to 9109.',
    })
    // Nothing above reached the pretend printer.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toEqual([])
  })

  it('says plainly when the printer is not there, without waiting long', async () => {
    const { port } = await listen()
    server!.close()
    server = undefined
    const refused = await networkPrinter({ allow: lanOrHere }).send({
      host: '127.0.0.1',
      port,
      bytes: drawerJob(),
    })
    expect(refused).toEqual({
      ok: false,
      detail:
        'The printer at 127.0.0.1 refused the connection. Check it is switched on and its address and port are right.',
    })
    const unknownName = await networkPrinter({
      lookup: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
      },
    }).send({ host: 'nowhere.lan', port: 9100, bytes: drawerJob() })
    expect(unknownName).toEqual({
      ok: false,
      detail: 'SALEANE could not find a printer called nowhere.lan on the studio’s network.',
    })
    // An address on the network where nothing answers gives up after the short timeout.
    const started = Date.now()
    const silent = await networkPrinter({ timeoutMs: 300 }).send({
      host: '10.255.255.1',
      port: 9100,
      bytes: drawerJob(),
    })
    expect(silent.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('keeps test jobs for showing, and sends them nowhere', async () => {
    const printer = testPrinter()
    expect(await printer.send({ host: '', port: 0, bytes: drawerJob() })).toEqual({ ok: true })
    expect(printer.jobs).toHaveLength(1)
    expect(printer.name).toBe('test')
  })
})
