import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StudioLook } from '../domain/brandRulesSchema'
import type { BusinessState } from '../domain/model'
import { operations } from '../domain/operations'
import { emailBlocks, emailPreheader } from './blocks'
import type { BlockOptions } from './blocks'
import { emailPalette, houseLook } from './colours'
import { EmailDocument } from './EmailDocument'

/**
 * NEXT-13: a message's designed email, made from its plain words when it is sent (and when it is
 * previewed). The plain words stay the record and go with it as the plain-text part, so an email
 * app that shows no design still shows every word.
 */
export type EmailSender = {
  name: string
  look?: StudioLook
  /** Small lines at the foot, such as the studio's address and phone. */
  contact?: string[]
  /** 'en-GB' or 'en-US', so a screen reader says the words the way they are spelt. */
  lang?: string
}
export type EmailInput = Omit<BlockOptions, 'signOff'> & {
  subject: string
  text: string
  from: EmailSender
}

export function renderEmail({ subject, text, from, ...options }: EmailInput) {
  const blocks = emailBlocks(text, { ...options, signOff: from.name })
  const markup = renderToStaticMarkup(
    createElement(EmailDocument, {
      subject,
      preheader: emailPreheader(blocks),
      blocks,
      lang: from.lang ?? 'en-GB',
      brand: {
        name: from.name,
        palette: emailPalette(from.look ?? houseLook),
        contact: from.contact ?? [],
      },
    }),
  )
  return `<!DOCTYPE html>${markup}`
}

/** A studio as the sender: its name, colours, address and phone, in its own spelling. */
export function studioSender(s: BusinessState): EmailSender {
  const org = s.organisation
  return {
    name: org.name,
    look: operations(s).look,
    contact: [org.address, org.phone, org.email].map((line) => line?.trim() ?? '').filter(Boolean),
    lang: org.locale,
  }
}

/** SALEANE itself, for account and billing emails: always the house look. */
export const saleaneSender: EmailSender = { name: 'SALEANE', look: houseLook, lang: 'en-GB' }
