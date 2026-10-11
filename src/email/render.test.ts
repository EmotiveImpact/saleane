import { describe, expect, it } from 'vitest'
import { seed } from '../domain/seed'
import { defaultOperations } from '../domain/operations'
import { firstColours, secondColours } from '../domain/brandRulesSchema'
import { MANAGE_LINK, STOP_LINE, composeClientMessage, composeMessage } from '../domain/reminders'
import type { VisitKind } from '../domain/reminders'
import { BOOK_LINK } from '../domain/reminderSettings'
import { emailBlocks } from './blocks'
import { INK, MUTED, PAGE, PAPER, contrast, emailPalette } from './colours'
import { renderEmail, saleaneSender, studioSender } from './render'
import { sampleKinds, sampleMessage } from './samples'

// NEXT-13: a designed email is a layout of the plain words, never a second wording.
const MANAGE = 'https://saleane.example/manage#private-code'
const BOOK = 'https://saleane.example/book/atelier-house'
const links = { [MANAGE_LINK]: MANAGE, [BOOK_LINK]: BOOK }

function studio() {
  const state = seed('UK')
  state.operations = { ...defaultOperations('local'), hours: defaultOperations().hours }
  state.organisation.phone = '020 7946 0000'
  const visit = state.appointments.find((a) => a.id === 'visit-noor')!
  return { state, visit }
}

/** What a reader sees: the page's words without the hidden line for the inbox list. */
function seen(html: string) {
  const page = new DOMParser().parseFromString(html, 'text/html')
  page.querySelector('div[style*="display:none"]')?.remove()
  return page
}
/** The words on the page, as a reader meets them, each element's apart from the next. */
function readable(html: string) {
  const walk = document.createTreeWalker(seen(html).body, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walk.nextNode()) parts.push(walk.currentNode.textContent ?? '')
  return parts.join(' ')
}
const words = (text: string) =>
  text
    .split(/\s+/)
    .filter((word) => word && !word.includes('{{') && !/^https?:/.test(word))
    .map((word) => word.replace(/[.,:;!?]+$/, ''))
    .filter(Boolean)

/** Every word of the plain text appears in the email, in the same order. */
function sameWords(text: string, html: string) {
  const shown = words(readable(html))
  let at = 0
  for (const word of words(text.replace(STOP_LINE, ''))) {
    const found = shown.indexOf(word, at)
    expect(found, `"${word}" is missing or out of order`).toBeGreaterThanOrEqual(0)
    at = found + 1
  }
  if (text.includes(STOP_LINE)) expect(seen(html).body.textContent).toContain(STOP_LINE)
}

describe('designed emails', () => {
  const visitKinds: VisitKind[] = [
    'confirmation',
    'changed',
    'reminder',
    'cancelled',
    'feedback',
    'patch_test',
    'aftercare',
    'due_back',
  ]

  it('keeps every word of every message SALEANE writes, in order', () => {
    const { state, visit } = studio()
    const client = state.clients.find((c) => c.id === visit.clientId)!
    const messages = [
      ...visitKinds.map((kind) => composeMessage(state, visit, kind, 'email')),
      composeClientMessage(state, client, 'birthday'),
      composeClientMessage(state, client, 'miss_you'),
    ]
    for (const { subject, body } of messages) {
      const html = renderEmail({ subject, text: body, links, from: studioSender(state) })
      sameWords(body, html)
      expect(seen(html).querySelector('h1')?.textContent).toBe(subject)
      expect(html).not.toContain('{{')
    }
  })

  it('sets a confirmation out as a greeting, the visit card, a button and the studio', () => {
    const { state, visit } = studio()
    const { subject, body } = composeMessage(state, visit, 'confirmation', 'email')
    expect(emailBlocks(body, { links, signOff: 'Atelier House' }).map((b) => b.type)).toEqual([
      'greeting',
      'paragraph',
      'details',
      'paragraph',
      'button',
      'signoff',
    ])
    const page = seen(renderEmail({ subject, text: body, links, from: studioSender(state) }))
    expect(page.documentElement.lang).toBe('en-GB')
    expect(page.title).toBe('Your visit to Atelier House is booked')
    const button = [...page.querySelectorAll('a')].find((a) => a.href === MANAGE)!
    expect(button.textContent).toBe('View, add to your calendar or cancel')
    expect(page.body.textContent).toContain('Skin Renewal Facial with Maya')
    // The studio's address and phone sit at the foot.
    expect(page.body.textContent).toContain('020 7946 0000')
    // Layout tables say they are layout to a screen reader.
    for (const table of page.querySelectorAll('table'))
      expect(table.getAttribute('role')).toBe('presentation')
  })

  it('names a button by what it does when its words are a sentence', () => {
    const { state, visit } = studio()
    const { subject, body } = composeMessage(state, visit, 'feedback', 'email')
    const page = seen(renderEmail({ subject, text: body, links, from: studioSender(state) }))
    const anchors = [...page.querySelectorAll('a')].map((a) => [a.textContent, a.href])
    expect(anchors).toEqual([
      ['Rate your visit and Maya', MANAGE],
      ['Leave a review', 'https://reviews.example.com/atelier-house'],
    ])
    // The words before each button stay, colon and all.
    expect(page.body.textContent).toContain(
      "Only the studio's owner and managers read what you write:",
    )
  })

  it('books a freed time from its own button and keeps the words after the link', () => {
    const text = [
      'Hello Ruby,',
      '',
      'A time has just opened for Skin Renewal Facial with Maya on Saturday 10 October at 10:00, and we thought of you.',
      '',
      `If you would like it, book it here: ${BOOK_LINK}?service=service-facial&staff=staff-maya&date=2026-10-10&start=600 It is not held for you, so the first to book it gets it.`,
      '',
      STOP_LINE,
      '',
      'Atelier House',
    ].join('\n')
    const html = renderEmail({
      subject: 'A time has opened at Atelier House',
      text,
      links,
      details: false,
      from: studioSender(studio().state),
    })
    sameWords(text, html)
    const page = seen(html)
    const button = page.querySelector('a')!
    expect(button.textContent).toBe('Book this time')
    expect(button.href).toBe(
      `${BOOK}?service=service-facial&staff=staff-maya&date=2026-10-10&start=600`,
    )
    expect(html).toContain('&amp;staff=staff-maya')
    // Why the guest hears from the studio goes small at the foot, below the studio's name.
    const paragraphs = [...page.querySelectorAll('p')].map((p) => p.textContent)
    expect(paragraphs.indexOf(STOP_LINE)).toBeGreaterThan(paragraphs.indexOf('Atelier House'))
  })

  it('makes no card of words a person typed, and links an address they wrote', () => {
    const text =
      'Hello Ruby,\n\nOpen from 09:00\nClosed Sundays\n\nOur new menu is at https://atelier.example/menu.\n\nAtelier House'
    const blocks = emailBlocks(text, { details: false, signOff: 'Atelier House' })
    expect(blocks.map((b) => b.type)).toEqual(['greeting', 'paragraph', 'paragraph', 'signoff'])
    const page = seen(
      renderEmail({ subject: 'News', text, details: false, from: studioSender(studio().state) }),
    )
    const link = page.querySelector('a')!
    expect(link.href).toBe('https://atelier.example/menu')
    expect(link.textContent).toBe('https://atelier.example/menu')
  })

  it('shows a button with no link as going nowhere, as in a preview', () => {
    const { state, visit } = studio()
    const { subject, body } = composeMessage(state, visit, 'reminder', 'email')
    const page = seen(renderEmail({ subject, text: body, from: studioSender(state) }))
    expect(page.querySelectorAll('a')).toHaveLength(0)
    expect(page.body.textContent).toContain('View, add to your calendar or cancel')
  })

  it('writes names and words as text, never as markup', () => {
    const { state, visit } = studio()
    state.organisation.name = 'Rose & <b>Thorn</b>'
    const client = state.clients.find((c) => c.id === visit.clientId)!
    client.name = '<img src=x onerror=alert(1)> Noor'
    const { subject, body } = composeMessage(state, visit, 'confirmation', 'email')
    const html = renderEmail({ subject, text: body, links, from: studioSender(state) })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('Rose &amp; &lt;b&gt;Thorn&lt;/b&gt;')
    expect(seen(html).querySelectorAll('img')).toHaveLength(0)
  })

  it('puts the link in an account email on a button in the house look', () => {
    const link = 'https://saleane.example/reset-password#code'
    const text = `Hello Ada,\n\nSomeone asked to choose a new password for your SALEANE account. If it was you, open this link within the next hour:\n\n${link}\n\nIf it was not you, ignore this email. Your password stays as it is.\n\nSALEANE`
    const html = renderEmail({
      subject: 'Choose a new SALEANE password',
      text,
      labels: { alone: 'Choose a new password' },
      from: saleaneSender,
    })
    sameWords(text, html)
    const button = seen(html).querySelector('a')!
    expect([button.textContent, button.href]).toEqual(['Choose a new password', link])
    expect(html).toContain(`background:${emailPalette().action}`)
  })

  it('reads at AA in every studio colour', () => {
    for (const first of firstColours)
      for (const second of secondColours) {
        const palette = emailPalette({ first: first.value, second: second.value })
        // White words on the button, and the quieter button's words on white.
        expect(contrast(palette.action, PAPER)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(INK, palette.soft)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(MUTED, palette.soft)).toBeGreaterThanOrEqual(4.5)
      }
    expect(contrast(MUTED, PAGE)).toBeGreaterThanOrEqual(4.5)
  })

  it('writes each sample with the studio’s own treatment for a made-up guest tomorrow', () => {
    const { state } = studio()
    for (const kind of sampleKinds) {
      const { subject, body } = sampleMessage(state, kind, '2026-10-06', '2026-10-06T08:00:00.000Z')
      expect(body.startsWith('Hello Alex,')).toBe(true)
      if (kind !== 'birthday') expect(body).toContain('Wednesday 7 October at 10:00')
      sameWords(body, renderEmail({ subject, text: body, links, from: studioSender(state) }))
    }
    // The studio's own records are left as they were.
    expect(state.clients.some((c) => c.name === 'Alex Morgan')).toBe(false)
  })
})
