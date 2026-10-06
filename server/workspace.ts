import { z } from 'zod'
import { seed } from '../src/domain/seed'
import { parseState } from '../src/domain/model'
import type { BusinessState } from '../src/domain/model'
import { defaultOperations } from '../src/domain/operations'
export const workspaceInput=z.object({name:z.string().trim().min(2).max(100),region:z.enum(['UK','US']),locationName:z.string().trim().min(2).max(100),timeZone:z.enum(['Europe/London','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Anchorage','Pacific/Honolulu']).optional(),sample:z.boolean().default(false)})
export function createWorkspace(input:z.infer<typeof workspaceInput>,ownerName:string,imported?:unknown):BusinessState {
  const id=crypto.randomUUID()
  const s=imported ? parseState(imported,input.region) : seed(input.region)
  s.organisation={...s.organisation,id,name:input.name,locationName:input.locationName,locationId:crypto.randomUUID(),address:'',timeZone:input.timeZone??(input.region==='UK'?'Europe/London':'America/New_York')}
  if(input.region==='UK'&&s.organisation.timeZone!=='Europe/London')throw new Error('Choose the London time zone for a UK business.')
  if(input.region==='US'&&s.organisation.timeZone==='Europe/London')throw new Error('Choose a US time zone.')
  s.operations=defaultOperations(input.sample?'sandbox':'live')
  if(!input.sample&&!imported) {
    s.clients=[];s.appointments=[];s.sales=[];s.payments=[];s.events=[];s.relationships=[]
    s.staff=[{id:crypto.randomUUID(),organisationId:id,name:ownerName,role:'Owner & professional',serviceIds:s.services.map(s=>s.id),tone:'sage'}]
    s.services.forEach(service=>{service.depositMinor=0})
    s.operations.bookingEnabled=false
  }
  for(const collection of [s.clients,s.services,s.staff,s.resources,s.appointments,s.sales,s.payments,s.events,s.relationships])for(const row of collection)row.organisationId=id
  for(const a of s.appointments)a.locationId=s.organisation.locationId
  s.revision=0
  return parseState(s,input.region)
}
