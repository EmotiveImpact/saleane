import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'
import type { BusinessState } from './model'

const id = z.string().min(1).max(150)
export const hoursSchema = z.object({ day: z.number().int().min(0).max(6), open: z.number().int().min(0).max(1439), close: z.number().int().min(1).max(1440), closed: z.boolean() }).refine(h => h.closed || h.close > h.open, 'Closing time must follow opening time.')
export const productSchema = z.object({ id, name: z.string().trim().min(2).max(100), sku: z.string().trim().max(50), priceMinor: z.number().int().nonnegative().max(10000000), reorderAt: z.number().int().nonnegative().max(10000), archived: z.boolean() })
export const movementSchema = z.object({ id, productId: id, quantity: z.number().int().min(-100000).max(100000), reason: z.enum(['received','consumed','adjustment','retail']), note: z.string().max(300), createdAt: z.iso.datetime(), actor: z.string(), appointmentId: id.optional() })
export const messageSchema = z.object({ id, clientId: id, appointmentId: id.optional(), purpose: z.enum(['appointment','marketing']), subject: z.string().min(1).max(150), body: z.string().min(1).max(3000), status: z.enum(['draft','queued','sent','failed','suppressed']), createdAt: z.iso.datetime(), actor: z.string(), sentAt: z.iso.datetime().optional(), providerId: z.string().optional(), failure: z.string().optional() })
export const operationsSchema = z.object({
  mode: z.enum(['sandbox','live']),
  bookingEnabled: z.boolean(),
  hours: z.array(hoursSchema).length(7),
  closures: z.array(z.object({ id, date: z.iso.date(), staffId: id.optional(), startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(1).max(1440), reason: z.string().max(150) })),
  products: z.array(productSchema), movements: z.array(movementSchema), messages: z.array(messageSchema),
  waitlist: z.array(z.object({ id, clientId: id, serviceId: id, fromDate: z.iso.date(), toDate: z.iso.date(), status: z.enum(['waiting','booked','closed']), appointmentId: id.optional(), createdAt: z.iso.datetime() })),
  refunds: z.array(z.object({ id, saleId: id, amountMinor: z.number().int().positive(), reason: z.string().min(3).max(300), reference: z.string().min(1).max(150), createdAt: z.iso.datetime(), actor: z.string() })),
})
export type Operations = z.infer<typeof operationsSchema>
export type Role = 'owner' | 'manager' | 'reception' | 'practitioner'
export function defaultOperations(mode: Operations['mode'] = 'sandbox'): Operations {
  return { mode, bookingEnabled: true, hours: Array.from({length:7},(_,day)=>({day,open:540,close:1080,closed:false})), closures:[], products:[], movements:[], messages:[], waitlist:[], refunds:[] }
}
export function operations(s: BusinessState) { return s.operations ?? defaultOperations() }
export function businessDate(s: BusinessState, now = new Date().toISOString()) {
  return operations(s).mode === 'sandbox' ? '2026-10-06' : Temporal.Instant.from(now).toZonedDateTimeISO(s.organisation.timeZone).toPlainDate().toString()
}
export function instantFor(s: BusinessState, date: string, minute: number) {
  const local = `${date}T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00`
  return Temporal.PlainDateTime.from(local).toZonedDateTime(s.organisation.timeZone,{disambiguation:'reject'}).toInstant().toString()
}
export function hoursFor(s: BusinessState, date: string) {
  const day = Temporal.PlainDate.from(date).dayOfWeek % 7
  return operations(s).hours.find(h=>h.day === day)!
}
export function stock(s: BusinessState, productId: string) { return operations(s).movements.filter(m=>m.productId===productId).reduce((sum,m)=>sum+m.quantity,0) }
export function can(role: Role, action: string) {
  if (role==='owner') return true
  if (['membership','restore','organisation'].includes(action)) return false
  if (role==='manager') return true
  if (['catalogue','hours','refund','stock','product','message.queue'].includes(action)) return false
  if (role==='reception') return true
  return ['read','arrive','note','book','reschedule'].includes(action)
}
