import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderToStaticMarkup as demoMarkup } from '../../demo/shims/reactServer'
import { emailBlocks, emailPreheader } from './blocks'
import { emailPalette, houseLook } from './colours'
import { EmailDocument } from './EmailDocument'

// The browser demo draws email previews with its own small renderer; it must match React's.
const texts = [
  'Hello Amelia,\n\nYour visit is booked.\n\nSkin Renewal Facial\nSaturday 10 October at 12:15\nwith Maya\n\nMove or cancel: {{manage_link}}\n\nSee you soon & take care <3 "quoted"',
  'Hi,\n\nBook again here: {{book_link}}\n\nhttps://example.com/x?a=1&b=2\n\nThanks',
  'A single line with ünïcödé, and it’s fine.',
]

describe('the browser demo’s email renderer', () => {
  it.each(texts)('draws an email exactly as React does', (text) => {
    const blocks = emailBlocks(text, {
      signOff: 'Atelier House',
      links: { '{{manage_link}}': 'https://x.test/m', '{{book_link}}': 'https://x.test/b' },
    })
    const email = createElement(EmailDocument, {
      subject: 'Your visit & more',
      preheader: emailPreheader(blocks),
      blocks,
      lang: 'en-GB',
      brand: {
        name: 'Atelier House',
        palette: emailPalette(houseLook),
        contact: ['1 High Street', '020 7946 0000'],
      },
    })
    expect(demoMarkup(email)).toBe(renderToStaticMarkup(email))
  })
})
