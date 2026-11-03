// The demo sends no email: its studios are samples in test mode, so the live senders (which need
// Node's key signing and a mail client) stay out of the browser build. Same names, never called.
export type EmailSenderName =
  'postmark' | 'resend' | 'sendgrid' | 'mailgun' | 'ses' | 'smtp' | 'google' | 'microsoft'

const notInDemo = (): never => {
  throw new Error('The demo sends no email.')
}
export const resendProvider = notInDemo
export const sendgridProvider = notInDemo
export const mailgunProvider = notInDemo
export const sesProvider = notInDemo
export const smtpProvider = notInDemo
export const googleProvider = notInDemo
export const microsoftProvider = notInDemo
export const resendReceipts = () => null
export const sendgridReceipts = () => null
export const mailgunReceipts = () => null
