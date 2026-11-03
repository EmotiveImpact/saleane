import type { CSSProperties, ReactNode } from 'react'
import type { Block, Inline } from './blocks'
import { INK, LINE, MUTED, PAGE, PAPER } from './colours'
import type { EmailPalette } from './colours'

/**
 * NEXT-13: the designed email, in the house language: a warm off-white page, the studio's name in
 * the serif, one white card, the visit's details on the studio's soft tint and a rounded button
 * in its colour. Built from tables with every style written on the element, which is what email
 * apps (Outlook and Gmail among them) reliably read.
 */
const SANS =
  "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const SERIF = "Newsreader, Georgia, 'Times New Roman', serif"

/** Gmail keeps a <style> block; this only narrows the padding on a phone. */
const CSS = `body{margin:0;padding:0;-webkit-text-size-adjust:100%;text-size-adjust:100%}
@media (max-width:520px){.card{padding:28px 20px!important}.title{font-size:22px!important}.page{padding:20px 12px!important}}`

const text: CSSProperties = {
  fontFamily: SANS,
  fontSize: 16,
  lineHeight: '26px',
  color: INK,
  margin: '0 0 16px',
}

export type EmailBrand = {
  /** The name at the top, and who the message is from. */
  name: string
  palette: EmailPalette
  /** Small lines at the foot, such as the studio's address and phone. */
  contact: string[]
}

export type EmailDocumentProps = {
  subject: string
  preheader: string
  blocks: Block[]
  brand: EmailBrand
  lang: string
}

function Table({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      // Separate, with no spacing: a bordered cell keeps its rounded corners, which a collapsed
      // table drops.
      style={{ borderCollapse: 'separate', ...style }}
    >
      <tbody>{children}</tbody>
    </table>
  )
}

function Words({ parts, palette }: { parts: Inline[]; palette: EmailPalette }) {
  return (
    <>
      {parts.map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            style={{ color: palette.action, textDecoration: 'underline', wordBreak: 'break-word' }}
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

function Lines({ lines, palette }: { lines: Inline[][]; palette: EmailPalette }) {
  return (
    <>
      {lines.map((parts, index) => (
        <span key={index}>
          {index > 0 && <br />}
          <Words parts={parts} palette={palette} />
        </span>
      ))}
    </>
  )
}

function EmailButton({
  block,
  palette,
}: {
  block: Extract<Block, { type: 'button' }>
  palette: EmailPalette
}) {
  const primary = block.tone === 'primary'
  const look: CSSProperties = {
    display: 'inline-block',
    padding: '14px 28px',
    borderRadius: 999,
    fontFamily: SANS,
    fontSize: 16,
    fontWeight: 600,
    lineHeight: '20px',
    textDecoration: 'none',
    color: primary ? PAPER : palette.action,
    background: primary ? palette.action : PAPER,
    border: `1px solid ${palette.action}`,
  }
  return (
    <Table style={{ margin: '4px 0 24px', width: 'auto' }}>
      <tr>
        <td style={{ borderRadius: 999, background: primary ? palette.action : PAPER }}>
          {block.href ? (
            <a href={block.href} style={look} target="_blank" rel="noopener">
              {block.label}
            </a>
          ) : (
            <span style={look}>{block.label}</span>
          )}
        </td>
      </tr>
    </Table>
  )
}

function Part({ block, palette }: { block: Block; palette: EmailPalette }) {
  switch (block.type) {
    case 'greeting':
      return <p style={text}>{block.text}</p>
    case 'paragraph':
      return (
        <p style={text}>
          <Lines lines={block.lines} palette={palette} />
        </p>
      )
    case 'details':
      return (
        <Table style={{ margin: '4px 0 20px' }}>
          <tr>
            <td style={{ background: palette.soft, borderRadius: 12, padding: '16px 20px' }}>
              {block.lines.map((line, index) => (
                <p
                  key={index}
                  style={{
                    ...text,
                    margin: 0,
                    fontSize: index === 0 ? 17 : 15,
                    lineHeight: index === 0 ? '26px' : '24px',
                    fontWeight: index === 0 ? 600 : 400,
                    color: index === 0 ? INK : MUTED,
                  }}
                >
                  {line}
                </p>
              ))}
            </td>
          </tr>
        </Table>
      )
    case 'button':
      return <EmailButton block={block} palette={palette} />
    case 'signoff':
      return (
        <p
          style={{
            ...text,
            fontFamily: SERIF,
            fontSize: 19,
            lineHeight: '26px',
            margin: '24px 0 0',
          }}
        >
          {block.text}
        </p>
      )
    case 'note':
      return null
  }
}

/** One message as a whole email page. */
export function EmailDocument({ subject, preheader, blocks, brand, lang }: EmailDocumentProps) {
  const { palette } = brand
  const notes = blocks.filter((block) => block.type === 'note')
  const small: CSSProperties = {
    fontFamily: SANS,
    fontSize: 13,
    lineHeight: '20px',
    color: MUTED,
    margin: '0 0 8px',
  }
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <meta name="x-apple-disable-message-reformatting" />
        <title>{subject}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body style={{ margin: 0, padding: 0, background: PAGE }}>
        {/* What the inbox shows beside the subject; never seen in the email itself. */}
        <div
          style={{
            display: 'none',
            overflow: 'hidden',
            maxHeight: 0,
            maxWidth: 0,
            opacity: 0,
            fontSize: 1,
            lineHeight: '1px',
            color: PAGE,
          }}
        >
          {preheader}
        </div>
        <Table style={{ background: PAGE }}>
          <tr>
            <td className="page" align="center" style={{ padding: '32px 16px' }}>
              <Table style={{ maxWidth: 560, margin: '0 auto' }}>
                <tr>
                  <td align="center" style={{ padding: '4px 0 24px' }}>
                    <p
                      style={{
                        fontFamily: SERIF,
                        fontSize: 26,
                        lineHeight: '32px',
                        color: INK,
                        margin: '0 0 12px',
                        letterSpacing: 0.2,
                      }}
                    >
                      {brand.name}
                    </p>
                    <Table style={{ width: 36, margin: '0 auto' }}>
                      <tr>
                        <td
                          style={{
                            height: 2,
                            background: palette.accent,
                            fontSize: 0,
                            lineHeight: '0px',
                          }}
                        >
                          &nbsp;
                        </td>
                      </tr>
                    </Table>
                  </td>
                </tr>
                <tr>
                  <td
                    className="card"
                    style={{
                      background: PAPER,
                      border: `1px solid ${LINE}`,
                      borderRadius: 16,
                      padding: '36px 32px',
                    }}
                  >
                    <h1
                      className="title"
                      style={{
                        fontFamily: SERIF,
                        fontSize: 24,
                        lineHeight: '32px',
                        fontWeight: 400,
                        color: INK,
                        margin: '0 0 20px',
                      }}
                    >
                      {subject}
                    </h1>
                    {blocks.map((block, index) => (
                      <Part key={index} block={block} palette={palette} />
                    ))}
                  </td>
                </tr>
                <tr>
                  <td align="center" style={{ padding: '24px 12px 0' }}>
                    {notes.map((note, index) => (
                      <p key={index} style={small}>
                        {note.type === 'note' && note.text}
                      </p>
                    ))}
                    {brand.contact.length > 0 && (
                      <p style={small}>
                        {brand.contact.map((line, index) => (
                          <span key={index}>
                            {index > 0 && <br />}
                            {line}
                          </span>
                        ))}
                      </p>
                    )}
                  </td>
                </tr>
              </Table>
            </td>
          </tr>
        </Table>
      </body>
    </html>
  )
}
