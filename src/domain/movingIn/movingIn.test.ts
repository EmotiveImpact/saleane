import { describe, expect, it } from 'vitest'
import { execute } from '../commands'
import type { Command } from '../commands'
import type { BusinessState } from '../model'
import { parseState } from '../model'
import { operations } from '../operations'
import { clientExport, clientExportText } from '../privacy'
import { createWorkspace } from '../workspace'
import { readSheet, readDelimited, guessDelimiter, excelSerialDate } from './sheet'
import { columnKind, fieldFromHeading, findHeadingRow, matchColumns, yesNo } from './fields'
import { recogniseLayout } from './systems'
import {
  birthdayFrom,
  dateOrder,
  internationalPhone,
  movingParts,
  reviewClients,
  tidyName,
  understandFile,
} from './clients'

// Moving in, stage 1: reading an old system's client list as it comes.
const now = '2026-10-09T09:00:00.000Z'
let n = 0
const makeId = () => `moving-${++n}`
const bytes = (text: string) => new TextEncoder().encode(text)
function studio(region: 'UK' | 'US' = 'UK'): BusinessState {
  return createWorkspace({ name: 'Moving test studio', region })
}
function apply(s: BusinessState, command: Command) {
  const result = execute(s, command, now, makeId)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

/** A minimal Excel workbook: a stored (uncompressed) zip of the parts SALEANE reads. */
function workbook(rows: (string | number)[][], dateColumns: number[] = []) {
  const strings: string[] = []
  const xmlEscape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const cells = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((value, c) => {
            const ref = `${String.fromCharCode(65 + c)}${r + 1}`
            if (typeof value === 'number')
              return `<c r="${ref}"${dateColumns.includes(c) ? ' s="1"' : ''}><v>${value}</v></c>`
            strings.push(value)
            return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`
          })
          .join('')}</row>`,
    )
    .join('')
  const files: Record<string, string> = {
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets><sheet name="Clients" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${cells}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<sst>${strings.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join('')}</sst>`,
    'xl/styles.xml':
      '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  }
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(text)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    const entry = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    entry.set(nameBytes, 46)
    chunks.push(local, data)
    central.push(entry)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((sum, c) => sum + c.length, 0))
  let at = 0
  for (const c of all) {
    out.set(c, at)
    at += c.length
  }
  return out
}

describe('reading files as they come', () => {
  it('reads comma, semicolon and tab files, quotes, a byte-order mark and Windows text', async () => {
    expect(guessDelimiter('Name;Email\nAnn;ann@example.com')).toBe(';')
    expect(guessDelimiter('Name\tEmail\nAnn\tann@example.com')).toBe('\t')
    expect(readDelimited('a.csv', 'Name,Notes\n"Smith, Ann","Said ""hi""\nthen left"\n\n')).toEqual(
      [
        ['Name', 'Notes'],
        ['Smith, Ann', 'Said "hi"\nthen left'],
      ],
    )
    const bom = await readSheet('b.csv', bytes('﻿Name,Email\nZoë,zoe@example.com'))
    expect(bom.rows[0][0]).toBe('Name')
    // Windows-1252 "é" (0xE9) is not valid UTF-8.
    const windows = await readSheet('c.csv', new Uint8Array([78, 44, 69, 10, 0x52, 0xe9, 44, 120]))
    expect(windows.rows[1][0]).toBe('Ré')
    // Excel's "Unicode text" is UTF-16 with tabs.
    const unicode = 'Name\tEmail\nZoë\tzoe@example.com'
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...unicode].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]),
    ])
    expect((await readSheet('d.txt', utf16)).rows[1]).toEqual(['Zoë', 'zoe@example.com'])
  })

  it('reads an Excel workbook, including dates stored as numbers', async () => {
    const file = workbook(
      [
        ['First name', 'Last name', 'Birthday'],
        ['Ann', 'Lee', 33000],
      ],
      [2],
    )
    const sheet = await readSheet('clients.xlsx', file)
    expect(sheet.rows).toEqual([
      ['First name', 'Last name', 'Birthday'],
      ['Ann', 'Lee', excelSerialDate(33000)],
    ])
    expect(excelSerialDate(33000)).toBe('1990-05-07')
  })

  it('explains files it cannot read instead of guessing', async () => {
    await expect(readSheet('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1]))).rejects.toThrow(
      /older Excel file/,
    )
    await expect(
      readSheet('report.xls', bytes('<html><table><tr><td>Name</td></tr></table></html>')),
    ).rejects.toThrow(/web page/)
    await expect(readSheet('empty.csv', new Uint8Array())).rejects.toThrow(/empty/)
    await expect(readSheet('bad.xlsx', bytes('PK\u0003\u0004 not really'))).rejects.toThrow(
      /could not be opened/,
    )
  })
})

describe('knowing what each column means', () => {
  it('understands the words different systems use', () => {
    expect(fieldFromHeading('Mobile number')).toBe('mobile')
    expect(fieldFromHeading('Cell Phone')).toBe('mobile')
    expect(fieldFromHeading('SMS Number')).toBe('mobile')
    expect(fieldFromHeading('E-mail address')).toBe('email')
    expect(fieldFromHeading('emailMarketingConsent')).toBe('emailMarketing')
    expect(fieldFromHeading('Accepts SMS marketing')).toBe('smsMarketing')
    expect(fieldFromHeading('Date of Birth')).toBe('birthday')
    expect(fieldFromHeading('Client mobile number')).toBe('mobile')
    expect(fieldFromHeading('Total sales')).toBeNull()
    expect(fieldFromHeading('Appointments Booked')).toBeNull()
  })

  it('checks headings against what is inside, so emails are emails whatever the heading', () => {
    const headings = ['Contact', 'Info', 'Mystery']
    const rows = [
      ['Ann Lee', 'ann@example.com', '07700 900123'],
      ['Bo Diaz', 'bo@example.com', '07700 900456'],
    ]
    const matches = matchColumns(headings, rows)
    expect(matches.map((m) => m.field)).toEqual(['fullName', 'email', 'mobile'])
    expect(matches[1].confidence).toBe('low')
    // "Contact" holding phone numbers is asked about rather than read as a second name.
    const vip = matchColumns(
      ['Client', 'Contact', 'Notes'],
      [
        ['Grace Mensah', '07700 900201', 'Offer tea'],
        ['Owen Price', '07700 900402', ''],
      ],
    )
    expect(vip.map((m) => [m.field, m.confidence])).toEqual([
      ['fullName', 'high'],
      ['mobile', 'low'],
      ['notes', 'high'],
    ])
    expect(columnKind(['yes', 'No', 'TRUE']).kind).toBe('yesno')
    expect(yesNo('Subscribed')).toBe(true)
    expect(yesNo('Unknown')).toBe(false)
    expect(yesNo('maybe')).toBeNull()
  })

  it('skips title rows above the headings and totals rows below', () => {
    const rows = [
      ['Client list'],
      ['1 Jan 2026 to 9 Oct 2026', ''],
      ['First name', 'Last name', 'Email'],
      ['Ann', 'Lee', 'ann@example.com'],
      ['Total', '', '1'],
    ]
    expect(findHeadingRow(rows)).toBe(2)
    const file = understandFile({ fileName: 'x.csv', rows })
    expect(file.rows).toEqual([['Ann', 'Lee', 'ann@example.com']])
    expect(file.lineNumbers).toEqual([4])
  })

  it('recognises the layouts confirmed for Fresha, Vagaro, Square and GlossGenius', () => {
    expect(
      recogniseLayout(['First name', 'Accepts marketing', 'Accepts SMS marketing']),
    ).toMatchObject({
      system: 'fresha',
      kind: 'clients',
    })
    expect(
      recogniseLayout(['Appt. ref.', 'Client', 'Team member', 'Status', 'Appt. slot']),
    ).toMatchObject({ system: 'fresha', kind: 'visits' })
    expect(recogniseLayout(['Name', 'Email', 'Phone', 'Date of Birth', 'Banned'])).toMatchObject({
      system: 'glossgenius',
    })
    expect(recogniseLayout(['Square Customer ID', 'Email Subscription Status'])).toMatchObject({
      system: 'square',
    })
    expect(recogniseLayout(['Name', 'Employees Seen', 'Customer Since'])).toMatchObject({
      system: 'vagaro',
    })
    expect(recogniseLayout(['Serial Number', 'Client', 'Remaining', 'Issue Date'])).toMatchObject({
      system: 'phorest',
      kind: 'giftCards',
    })
    expect(recogniseLayout(['Name', 'Email'])).toBeNull()
  })

  it('tells a list of visits or gift cards from a client list', () => {
    const visits = understandFile({
      fileName: 'v.csv',
      rows: [
        ['Date', 'Service', 'Staff', 'Client'],
        ['01/11/2026', 'Cut', 'Maya', 'Ann'],
      ],
    })
    expect(visits.kind).toBe('visits')
    const vouchers = understandFile({
      fileName: 'g.csv',
      rows: [
        ['Voucher code', 'Client', 'Balance'],
        ['ABC', 'Ann', '20.00'],
      ],
    })
    expect(vouchers.kind).toBe('giftCards')
  })
})

describe('tidying values', () => {
  it('turns local phone numbers into international ones for the studio’s country', () => {
    expect(internationalPhone('07700 900123', 'UK')).toBe('+447700900123')
    expect(internationalPhone('7700900123', 'UK')).toBe('+447700900123')
    expect(internationalPhone('+44 (0)20 7946 0018', 'UK')).toBe('+442079460018')
    expect(internationalPhone('0044 20 7946 0018', 'UK')).toBe('+442079460018')
    expect(internationalPhone('(212) 555-0142', 'US')).toBe('+12125550142')
    expect(internationalPhone('10000000000', 'US')).toBeNull()
    expect(internationalPhone('n/a', 'UK')).toBeNull()
  })

  it('reads birthdays in each system’s style and keeps only month and day', () => {
    expect(birthdayFrom('1990-03-14', 'dayFirst')).toBe('03-14')
    expect(birthdayFrom('14/03/1990', 'dayFirst')).toBe('03-14')
    expect(birthdayFrom('03/14/1990', 'monthFirst')).toBe('03-14')
    expect(birthdayFrom('14 Mar 1990', 'dayFirst')).toBe('03-14')
    expect(birthdayFrom('March 14th', 'dayFirst')).toBe('03-14')
    expect(birthdayFrom('31/02/1990', 'dayFirst')).toBeNull()
    expect(birthdayFrom('soon', 'dayFirst')).toBeNull()
    expect(dateOrder(['03/04/1990', '25/12/1985'], 'US')).toBe('dayFirst')
    expect(dateOrder(['12/25/1985'], 'UK')).toBe('monthFirst')
    expect(dateOrder(['03/04/1990'], 'UK')).toBe('dayFirst')
  })

  it('tidies names written in capitals or surname first', () => {
    expect(tidyName('', '', 'SMITH, JANE')).toBe('Jane Smith')
    expect(tidyName('mary', "o'neil", '')).toBe("Mary O'Neil")
    expect(tidyName('', '', 'MCDONALD AMY')).toBe('Mcdonald Amy'.replace('Mcdonald', 'McDonald'))
    expect(tidyName('Ann-Marie', 'de Souza', 'ignored')).toBe('Ann-Marie de Souza')
  })
})

const FRESHA = [
  'First name,Last name,Mobile number,Email,Birthday,Notes,Accepts marketing,Accepts SMS marketing,Total sales',
  'Ann,Lee,07700 900123,ann@example.com,14/03/1990,Prefers mornings,Yes,No,£420.00',
  'Bo,Diaz,07700 900456,,,,No,Yes,£0.00',
  'Cy,Park,,cy@example.com,31/02/1990,,,,£15.00',
  ',,,,,,,,',
  'Dee,Ray,not a number,,,,,,£0.00',
  'Ann,Lee,07700 900123,ann@example.com,,Allergic to nuts,Yes,No,£420.00',
].join('\n')

async function freshaFile(text = FRESHA) {
  return understandFile(await readSheet('fresha-clients.csv', bytes(text)))
}

describe('a Fresha client list, end to end', () => {
  it('recognises the file and every column without asking', async () => {
    const file = await freshaFile()
    expect(file).toMatchObject({ system: 'fresha', kind: 'clients', report: 'client list' })
    expect(file.matches.map((m) => m.field)).toEqual([
      'firstName',
      'lastName',
      'mobile',
      'email',
      'birthday',
      'notes',
      'emailMarketing',
      'smsMarketing',
      null,
    ])
    expect(file.matches.at(-1)?.leftOut).toMatch(/worked out again/)
  })

  it('reviews each row: ready, combined, already here or needing a fix', async () => {
    const s = studio()
    const review = reviewClients([await freshaFile()], s, 'fresha')
    expect(review.counts).toEqual({ ready: 3, here: 0, problem: 1, combined: 1 })
    const [ann, bo, cy] = review.ready
    expect(ann).toMatchObject({
      name: 'Ann Lee',
      email: 'ann@example.com',
      phone: '+447700900123',
      birthday: '03-14',
      marketingConsent: true,
      consentEvidence: 'Fresha recorded “Accepts marketing: Yes”',
      preferences: 'Prefers mornings\nAllergic to nuts',
    })
    expect(bo).toMatchObject({
      email: '',
      phone: '+447700900456',
      marketingConsent: false,
      textMarketing: true,
    })
    expect(cy).toMatchObject({ phone: '', marketingConsent: false })
    expect(cy.birthday).toBeUndefined()
    expect(review.rows.find((r) => r.line === 4)?.notes[0]).toMatch(
      /birthday “31\/02\/1990” could not be read/,
    )
    expect(review.rows.find((r) => r.status === 'problem')?.detail).toMatch(
      /Dee Ray has no email or phone/,
    )
    expect(review.marketing).toBe(1)
  })

  it('brings clients across with birthdays, notes and evidence for marketing', async () => {
    const s0 = studio()
    const review = reviewClients([await freshaFile()], s0, 'fresha')
    const s = apply(s0, {
      type: 'import-clients',
      source: 'Fresha client list',
      reviewed: true,
      contacts: review.ready,
    })
    const ann = s.clients.find((c) => c.name === 'Ann Lee')!
    expect(ann).toMatchObject({
      birthday: '03-14',
      marketingConsent: true,
      preferences: 'Prefers mornings\nAllergic to nuts',
    })
    expect(s.consentRecords).toEqual([
      expect.objectContaining({
        clientId: ann.id,
        given: true,
        source: 'previous system',
        evidence: 'Fresha recorded “Accepts marketing: Yes”',
      }),
    ])
    expect(s.consentRecords?.[0].wordingVersion).toBeUndefined()
    expect(s.clients.find((c) => c.name === 'Bo Diaz')).toMatchObject({
      email: '',
      marketingConsent: false,
    })
    expect(s.events.find((e) => e.clientId === ann.id)?.detail).toMatch(
      /Email marketing came across: Fresha recorded “Accepts marketing: Yes”/,
    )
    expect(operations(s).imports?.at(-1)).toMatchObject({
      kind: 'clients',
      source: 'Fresha client list',
    })
    // A copy of Ann's records says where her permission came from; Bo's says he has no email.
    const meta = { generatedAt: '2026-10-09T12:00:00.000Z', generatedBy: 'Owner' }
    expect(clientExportText(clientExport(s, ann.id, meta))).toContain(
      'agreed in their previous system: Fresha recorded “Accepts marketing: Yes” · previous system',
    )
    const bo = s.clients.find((c) => c.name === 'Bo Diaz')!
    expect(clientExportText(clientExport(s, bo.id, meta))).toContain('Email: Not recorded')
    // The saved studio still passes every check when it is read back.
    expect(() => parseState(JSON.parse(JSON.stringify(s)), 'UK')).not.toThrow()
    // Moving the same list again finds everyone already here and changes nothing.
    const again = reviewClients([await freshaFile()], s, 'fresha')
    expect(again.counts.ready).toBe(0)
    expect(again.counts.here).toBe(4)
  })

  it('never lets permission come across without the old system’s evidence', () => {
    const s = studio()
    const contact = {
      name: 'Eve Cole',
      email: 'eve@example.com',
      phone: '',
      marketingConsent: true,
    }
    expect(
      execute(s, { type: 'import-clients', reviewed: true, contacts: [contact] }, now, makeId).ok,
    ).toBe(false)
    expect(
      execute(
        s,
        {
          type: 'import-clients',
          reviewed: true,
          contacts: [{ ...contact, email: '', phone: '' }],
        },
        now,
        makeId,
      ).ok,
    ).toBe(false)
  })

  it('keeps a client already here untouched, and keeps people who only share a number', async () => {
    let s = studio()
    s = apply(s, {
      type: 'import-clients',
      reviewed: true,
      contacts: [{ name: 'Ann Lee', email: 'ann@example.com', phone: '', marketingConsent: false }],
    })
    const file = understandFile(
      await readSheet(
        'phone.csv',
        bytes('Name,Mobile\nAnn Lee,07700 900999\nTom Lee,07700 900999\nKid Lee,07700 900999'),
      ),
    )
    const review = reviewClients([file], s, 'other')
    // Ann has a different number here, so she is not recognised as the same person; Tom and Kid share one.
    expect(review.counts.ready).toBe(3)
    expect(review.rows[1].notes[0]).toMatch(/Shares a phone number with Ann Lee/)
    const repeat = reviewClients(
      [understandFile(await readSheet('again.csv', bytes('Name,Email\nann lee,ANN@example.com')))],
      s,
      'other',
    )
    expect(repeat.counts.here).toBe(1)
    expect(
      execute(
        s,
        {
          type: 'import-clients',
          reviewed: true,
          contacts: [
            { name: 'Ann Lee', email: 'ann@example.com', phone: '', marketingConsent: false },
          ],
        },
        now,
        makeId,
      ).ok,
    ).toBe(false)
  })

  it('combines the same person from two of the old system’s files', async () => {
    const emails = understandFile(
      await readSheet('emails.csv', bytes('First Name,Last Name,Email\nAnn,Lee,ann@example.com')),
    )
    const addresses = understandFile(
      await readSheet(
        'addresses.csv',
        bytes(
          'First Name,Last Name,Email,Address,Mobile\nAnn,Lee,ann@example.com,"1 High St, London N1 9GU",07700900123',
        ),
      ),
    )
    const review = reviewClients([emails, addresses], studio(), 'phorest')
    expect(review.counts).toMatchObject({ ready: 1, combined: 1 })
    expect(review.ready[0]).toMatchObject({ phone: '+447700900123', postcodeArea: 'N1' })
  })

  it('starts marketing off for a client with no email to send it to', async () => {
    const file = understandFile(
      await readSheet(
        'phone-only.csv',
        bytes('Name,Mobile,Accepts marketing\nCy Hale,07700900777,Yes'),
      ),
    )
    const review = reviewClients([file], studio(), 'fresha')
    expect(review.ready[0]).toMatchObject({ email: '', marketingConsent: false })
    expect(review.ready[0].consentEvidence).toBeUndefined()
    expect(review.rows[0].notes).toContain(
      'Agreed to marketing in the old system but has no email, so marketing starts off.',
    )
    expect(review.marketing).toBe(0)
  })

  it('reads a US Square export with its subscription column', async () => {
    const file = understandFile(
      await readSheet(
        'square.csv',
        bytes(
          'Square Customer ID,First Name,Last Name,Email Address,Phone Number,Email Subscription Status,Birthday,Postal Code\nX1,Joy,Hart,joy@example.com,(212) 555-0142,Subscribed,1988-07-04,10001\nX2,Ray,Hart,ray@example.com,,unknown,,',
        ),
      ),
    )
    expect(file.system).toBe('square')
    const review = reviewClients([file], studio('US'), 'square')
    expect(review.ready[0]).toMatchObject({
      phone: '+12125550142',
      birthday: '07-04',
      postcodeArea: '100',
      marketingConsent: true,
      consentEvidence: 'Square recorded “Email Subscription Status: Subscribed”',
    })
    expect(review.ready[1].marketingConsent).toBe(false)
  })

  it('splits a long list into parts the server accepts', () => {
    const many = Array.from({ length: 1300 }, (_, i) => ({
      name: `Client ${i}`,
      email: `c${i}@example.com`,
      phone: '',
      marketingConsent: false,
      preferences: 'x'.repeat(100),
    }))
    const parts = movingParts(many)
    expect(parts.length).toBeGreaterThan(2)
    expect(parts.flat()).toHaveLength(1300)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(500)
      expect(new TextEncoder().encode(JSON.stringify(part)).byteLength).toBeLessThan(60 * 1024)
    }
  })
})

describe('editing a client who came across without an email', () => {
  it('saves notes without asking for an email they never had, but keeps one they have', () => {
    let s = studio()
    s = apply(s, {
      type: 'import-clients',
      reviewed: true,
      contacts: [{ name: 'Bo Diaz', email: '', phone: '+447700900456', marketingConsent: false }],
    })
    const bo = s.clients.at(-1)!
    s = apply(s, {
      type: 'client-edit',
      clientId: bo.id,
      contact: { name: 'Bo Diaz', email: '', phone: '+447700900456', marketingConsent: false },
      preferences: 'Likes quiet appointments',
    })
    expect(s.clients.at(-1)?.preferences).toBe('Likes quiet appointments')
    s = apply(s, {
      type: 'client-edit',
      clientId: bo.id,
      contact: {
        name: 'Bo Diaz',
        email: 'bo@example.com',
        phone: '+447700900456',
        marketingConsent: false,
      },
      preferences: '',
    })
    expect(
      execute(
        s,
        {
          type: 'client-edit',
          clientId: bo.id,
          contact: { name: 'Bo Diaz', email: '', phone: '+447700900456', marketingConsent: false },
          preferences: '',
        },
        now,
        makeId,
      ).ok,
    ).toBe(false)
  })
})
