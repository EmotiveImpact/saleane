import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'
import { clientSchema, parseState, serviceSchema, staffSchema, resourceSchema } from './model'
import type { BusinessState } from './model'
import { availableResource, execute } from './commands'
import type { CommandResult } from './commands'
import { businessDate, hoursSchema, instantFor, operations, productSchema, stock } from './operations'

const id = z.string().min(1).max(150)
const contact = clientSchema.pick({name:true,email:true,phone:true,marketingConsent:true})
const appointmentInput = z.object({serviceId:id,staffId:id,date:z.iso.date(),startMinutes:z.number().int().min(0).max(1439),clientId:id.optional(),contact:contact.optional(),source:z.enum(['desk','online','rebook']),rebookedFromId:id.optional()}).strict()
const method = z.enum(['cash','external_card','demo_cash','demo_card'])
export const commandSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('book'),input:appointmentInput}).strict(),
  z.object({type:z.literal('arrive'),appointmentId:id}).strict(),
  z.object({type:z.literal('checkout'),appointmentId:id,tipMinor:z.number().int().nonnegative(),method,reference:z.string().trim().max(150).optional()}).strict(),
  z.object({type:z.literal('note'),clientId:id,text:z.string().trim().min(2).max(1000)}).strict(),
  z.object({type:z.literal('client'),contact,referredById:id.optional()}).strict(),
  z.object({type:z.literal('consent'),clientId:id,consent:z.boolean()}).strict(),
  z.object({type:z.literal('reschedule'),appointmentId:id,date:z.iso.date(),startMinutes:z.number().int().min(0).max(1439),staffId:id,reason:z.string().trim().min(3).max(300)}).strict(),
  z.object({type:z.literal('cancel'),appointmentId:id,reason:z.string().trim().min(3).max(300)}).strict(),
  z.object({type:z.literal('service'),value:serviceSchema.omit({organisationId:true})}).strict(),
  z.object({type:z.literal('staff'),value:staffSchema.omit({organisationId:true})}).strict(),
  z.object({type:z.literal('resource'),value:resourceSchema.omit({organisationId:true})}).strict(),
  z.object({type:z.literal('hours'),hours:z.array(hoursSchema).length(7)}).strict(),
  z.object({type:z.literal('closure'),date:z.iso.date(),staffId:id.optional(),startMinutes:z.number().int().min(0).max(1439),endMinutes:z.number().int().min(1).max(1440),reason:z.string().trim().min(2).max(150)}).strict(),
  z.object({type:z.literal('closure.remove'),id}).strict(),
  z.object({type:z.literal('organisation'),name:z.string().trim().min(2).max(100),locationName:z.string().trim().min(2).max(100),address:z.string().trim().max(300),bookingEnabled:z.boolean()}).strict(),
  z.object({type:z.literal('product'),value:productSchema}).strict(),
  z.object({type:z.literal('stock'),productId:id,quantity:z.number().int().min(-100000).max(100000),reason:z.enum(['received','consumed','adjustment']),note:z.string().trim().min(3).max(300),appointmentId:id.optional()}).strict(),
  z.object({type:z.literal('message'),clientId:id,purpose:z.enum(['appointment','marketing']),subject:z.string().trim().min(3).max(150),body:z.string().trim().min(3).max(3000)}).strict(),
  z.object({type:z.literal('message.queue'),id}).strict(),
  z.object({type:z.literal('message.cancel'),id}).strict(),
  z.object({type:z.literal('waitlist'),clientId:id,serviceId:id,fromDate:z.iso.date(),toDate:z.iso.date()}).strict(),
  z.object({type:z.literal('waitlist.close'),id,appointmentId:id.optional()}).strict(),
  z.object({type:z.literal('refund'),saleId:id,amountMinor:z.number().int().positive(),reason:z.string().trim().min(3).max(300),reference:z.string().trim().min(3).max(150)}).strict(),
])
export type AppCommand = z.infer<typeof commandSchema>
export function permissionFor(c: AppCommand) { return ['service','staff','resource','closure','closure.remove'].includes(c.type) ? 'catalogue' : c.type }
export function dispatch(state: BusinessState, input: unknown, actor: string, now = new Date().toISOString()): CommandResult {
  try {
    const c = commandSchema.parse(input)
    const legacy = ['book','arrive','checkout','note','client','consent'].includes(c.type)
    if (legacy) {
      const result = execute(state, c as Parameters<typeof execute>[1], now)
      if (!result.ok || result.state === state) return result
      const existing = new Set(state.events.map(e=>e.id))
      result.state.events.filter(e=>!existing.has(e.id)).forEach(e=>{e.actor=actor})
      if (c.type==='book') {
        const a = result.state.appointments.find(a=>a.id===result.recordId)!
        result.state.operations = structuredClone(operations(result.state))
        result.state.operations.messages.push({id:crypto.randomUUID(),clientId:a.clientId,appointmentId:a.id,purpose:'appointment',subject:`Your visit to ${state.organisation.name}`,body:`Your appointment is confirmed for ${a.date} at ${String(Math.floor(a.startMinutes/60)).padStart(2,'0')}:${String(a.startMinutes%60).padStart(2,'0')} (${state.organisation.timeZone}). Please contact the studio to make any changes.`,status:'draft',createdAt:now,actor})
      }
      if (c.type==='consent' && !c.consent && result.state.operations) result.state.operations.messages.forEach(m=>{if(m.clientId===c.clientId && m.purpose==='marketing' && m.status==='queued')m.status='suppressed'})
      return result
    }
    const s = structuredClone(state)
    s.operations = structuredClone(operations(s))
    const o = s.operations
    let recordId = crypto.randomUUID() as string
    const event = (clientId:string,title:string,detail:string,type:'rescheduled'|'cancelled'|'refund'|'message',appointmentId?:string,saleId?:string) => s.events.push({id:crypto.randomUUID(),organisationId:s.organisation.id,clientId,appointmentId,saleId,type,title,detail,occurredAt:now,actor})
    if (c.type==='cancel' || c.type==='reschedule') {
      const a = s.appointments.find(a=>a.id===c.appointmentId)
      if (!a || a.status!=='confirmed') throw new Error('Only a confirmed appointment can be changed.')
      if(c.type==='cancel') {
        a.status='cancelled'
        event(a.clientId,'Appointment cancelled',c.reason,'cancelled',a.id)
      } else {
        const check = structuredClone(s)
        check.appointments = check.appointments.filter(x=>x.id!==a.id)
        const service = check.services.find(x=>x.id===a.serviceId)!
        service.durationMinutes=a.bookedDurationMinutes; service.bufferMinutes=a.bookedBufferMinutes
        const resourceId=availableResource(check,a.serviceId,c.staffId,c.date,c.startMinutes)
        if(!resourceId) throw new Error('That time is unavailable. The original appointment has been kept.')
        const before=`${a.date} at ${a.startMinutes}`
        Object.assign(a,{date:c.date,startMinutes:c.startMinutes,staffId:c.staffId,resourceId,startsAt:instantFor(s,c.date,c.startMinutes),endsAt:Temporal.Instant.from(instantFor(s,c.date,c.startMinutes)).add({minutes:a.bookedDurationMinutes+a.bookedBufferMinutes}).toString()})
        event(a.clientId,'Appointment rescheduled',`${before} → ${c.date} at ${c.startMinutes}. ${c.reason}`,'rescheduled',a.id)
      }
      recordId=a.id
    } else if(c.type==='service' || c.type==='staff' || c.type==='resource') {
      if(c.value.archived && s.appointments.some(a=>(a.status==='confirmed'||a.status==='arrived') && (c.type==='service'?a.serviceId:c.type==='staff'?a.staffId:a.resourceId)===c.value.id)) throw new Error('Move or finish upcoming appointments before archiving this item.')
      if(c.type==='service') {
        if(c.value.durationMinutes<15 || c.value.durationMinutes>480 || c.value.bufferMinutes>120 || !c.value.name.trim() || c.value.depositMinor>c.value.priceMinor) throw new Error('Review the service duration, price and deposit.')
        const value={...c.value,organisationId:s.organisation.id}; const i=s.services.findIndex(x=>x.id===value.id); if(i<0)s.services.push(value);else s.services[i]=value
      } else if(c.type==='staff') {
        if(!c.value.name.trim()) throw new Error('Enter a professional’s name.')
        const value={...c.value,organisationId:s.organisation.id}; const i=s.staff.findIndex(x=>x.id===value.id); if(i<0)s.staff.push(value);else s.staff[i]=value
      } else {
        if(!c.value.name.trim()) throw new Error('Enter a space name.')
        const value={...c.value,organisationId:s.organisation.id}; const i=s.resources.findIndex(x=>x.id===value.id); if(i<0)s.resources.push(value);else s.resources[i]=value
      }
      recordId=c.value.id
    } else if(c.type==='hours') {
      if(new Set(c.hours.map(h=>h.day)).size!==7) throw new Error('Set hours for all seven days.')
      for(const a of s.appointments.filter(a=>['confirmed','arrived'].includes(a.status))) {
        const h=c.hours.find(h=>h.day===Temporal.PlainDate.from(a.date).dayOfWeek%7)!
        if(h.closed||a.startMinutes<h.open||a.startMinutes+a.bookedDurationMinutes+a.bookedBufferMinutes>h.close) throw new Error('The new hours would leave an existing appointment outside opening hours. Move it first.')
      }
      o.hours=c.hours
    } else if(c.type==='closure') {
      if(c.endMinutes<=c.startMinutes || (c.staffId&&!s.staff.some(x=>x.id===c.staffId))) throw new Error('Choose a valid professional and time range.')
      if(s.appointments.some(a=>a.date===c.date&&a.status!=='cancelled'&&(!c.staffId||a.staffId===c.staffId)&&c.startMinutes<a.startMinutes+a.bookedDurationMinutes+a.bookedBufferMinutes&&c.endMinutes>a.startMinutes)) throw new Error('This closure overlaps an appointment. Move the appointment first.')
      o.closures.push({id:recordId,date:c.date,staffId:c.staffId,startMinutes:c.startMinutes,endMinutes:c.endMinutes,reason:c.reason})
    } else if(c.type==='closure.remove') {o.closures=o.closures.filter(x=>x.id!==c.id);recordId=c.id}
    else if(c.type==='organisation') {Object.assign(s.organisation,{name:c.name,locationName:c.locationName,address:c.address});o.bookingEnabled=c.bookingEnabled;recordId=s.organisation.id}
    else if(c.type==='product') {
      if(o.products.some(p=>p.id!==c.value.id&&p.sku&&p.sku===c.value.sku))throw new Error('This stock code is already in use.')
      const i=o.products.findIndex(p=>p.id===c.value.id);if(i<0)o.products.push(c.value);else o.products[i]=c.value;recordId=c.value.id
    } else if(c.type==='stock') {
      if(!o.products.some(p=>p.id===c.productId&&!p.archived)||!c.quantity||stock(s,c.productId)+c.quantity<0)throw new Error('Choose an active product and a movement that leaves stock at zero or above.')
      o.movements.push({id:recordId,productId:c.productId,quantity:c.quantity,reason:c.reason,note:c.note,appointmentId:c.appointmentId,createdAt:now,actor})
    } else if(c.type==='message') {
      if(!s.clients.some(x=>x.id===c.clientId))throw new Error('Choose a client in this workspace.')
      o.messages.push({id:recordId,clientId:c.clientId,purpose:c.purpose,subject:c.subject,body:c.body,status:'draft',createdAt:now,actor})
    } else if(c.type==='message.queue' || c.type==='message.cancel') {
      const m=o.messages.find(m=>m.id===c.id);if(!m||!['draft','queued','failed'].includes(m.status))throw new Error('This message can no longer be changed.')
      const client=s.clients.find(x=>x.id===m.clientId)!
      if(c.type==='message.queue'&&m.purpose==='marketing'&&!client.marketingConsent)throw new Error('Marketing consent is off for this client. This message cannot be queued.')
      m.status=c.type==='message.queue'?'queued':'draft';recordId=m.id
      if(c.type==='message.queue')event(m.clientId,'Message queued',m.subject,'message',m.appointmentId)
    } else if(c.type==='waitlist') {
      if(c.fromDate>c.toDate||c.toDate<businessDate(s,now))throw new Error('Choose a current or future date range.')
      o.waitlist.push({id:recordId,clientId:c.clientId,serviceId:c.serviceId,fromDate:c.fromDate,toDate:c.toDate,status:'waiting',createdAt:now})
    } else if(c.type==='waitlist.close') {
      const w=o.waitlist.find(x=>x.id===c.id);if(!w)throw new Error('Waiting-list request was not found.')
      const a=s.appointments.find(a=>a.id===c.appointmentId)
      if(c.appointmentId&&(!a||a.clientId!==w.clientId||a.serviceId!==w.serviceId||a.status==='cancelled'))throw new Error('Choose a matching client appointment.')
      w.status=c.appointmentId?'booked':'closed';w.appointmentId=c.appointmentId;recordId=w.id
    } else if(c.type==='refund') {
      const sale=s.sales.find(x=>x.id===c.saleId)
      if(!sale||o.refunds.filter(r=>r.saleId===c.saleId).reduce((sum,r)=>sum+r.amountMinor,0)+c.amountMinor>sale.totalMinor)throw new Error('Refund exceeds the amount collected for this sale.')
      o.refunds.push({id:recordId,saleId:c.saleId,amountMinor:c.amountMinor,reason:c.reason,reference:c.reference,createdAt:now,actor})
      const a=s.appointments.find(a=>a.id===sale.appointmentId)!
      event(a.clientId,'External refund recorded',`${c.amountMinor} minor units. ${c.reason}. Reference: ${c.reference}`,'refund',a.id,sale.id)
    }
    s.revision++
    return {ok:true,state:parseState(s,s.organisation.region),recordId}
  } catch(error) {return {ok:false,error:error instanceof z.ZodError ? 'Check the required fields and try again.' : error instanceof Error ? error.message : 'Unable to save this change.'}}
}
