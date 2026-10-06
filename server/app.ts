import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import staticFiles from '@fastify/static'
import rateLimit from '@fastify/rate-limit'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Database, Queryable } from './database'
import { migrate } from './database'
import { token, digest, passwordHash, checkPassword } from './auth'
import { createWorkspace, workspaceInput } from './workspace'
import { parseState } from '../src/domain/model'
import type { BusinessState } from '../src/domain/model'
import { commandSchema, dispatch, permissionFor } from '../src/domain/dispatch'
import { availableResource, slots } from '../src/domain/commands'
import { businessDate, can, operations } from '../src/domain/operations'
import type { Role } from '../src/domain/operations'

class HttpError extends Error { constructor(public statusCode:number,message:string){super(message)} }
const fail=(code:number,message:string):never=>{throw new HttpError(code,message)}
type Actor={id:string;email:string;name:string;csrf:string}
type OrgRow={id:string;slug:string;state:BusinessState;role:Role}
const registration=z.object({name:z.string().trim().min(2).max(100),email:z.email().max(254),password:z.string().min(12).max(128),workspace:workspaceInput.optional(),invitation:z.string().optional()}).strict()
const loginSchema=z.object({email:z.email().max(254),password:z.string().min(1).max(128)})
const cookieName='saleane_session'
export async function buildApp(options:{db:Database;origin:string;static?:boolean;allowDemo?:boolean;email?:{key:string;from:string}}) {
  const {db,origin}=options
  await migrate(db)
  const app=Fastify({logger:false,bodyLimit:1024*1024,trustProxy:false})
  await app.register(cookie)
  await app.register(rateLimit,{max:180,timeWindow:'1 minute'})
  const dummyHash=await passwordHash(token())
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin').header('X-Frame-Options','DENY')
    if(req.url.startsWith('/api/'))reply.header('Cache-Control','no-store')
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if(req.headers.origin!==origin)fail(403,'This request must come from your SALEANE workspace.')
      if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'Use a JSON request.')
    }
  })
  app.setErrorHandler((error,_req,reply)=>{
    const status=error instanceof z.ZodError?400:('statusCode' in error?Number(error.statusCode):500)
    reply.code(status>=400&&status<600?status:500).send({error:error instanceof z.ZodError?'Check the required fields and try again.':status<500?error.message:'The change could not be saved. Please try again.'})
  })
  const session=async(req:FastifyRequest,write=false):Promise<Actor>=>{
    const raw=req.cookies[cookieName];if(!raw)fail(401,'Sign in to continue.')
    const {rows}=await db.query<Actor>(`SELECT a.id,a.email,a.name,s.csrf FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()`,[digest(raw)])
    const actor=rows[0];if(!actor)fail(401,'Your session has ended. Sign in again.')
    if(write&&req.headers['x-csrf-token']!==actor.csrf)fail(403,'Refresh the workspace before saving.')
    return actor
  }
  const signIn=async(reply:FastifyReply,id:string)=>{
    const raw=token(),csrf=token()
    await db.query('INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,$4)',[digest(raw),id,csrf,new Date(Date.now()+7*86400000)])
    reply.setCookie(cookieName,raw,{path:'/',httpOnly:true,sameSite:'strict',secure:origin.startsWith('https:'),maxAge:7*86400})
    return csrf
  }
  const organisations=async(actor:Actor)=> (await db.query<{id:string;slug:string;role:Role;name:string;region:string;mode:string}>(`SELECT o.id,o.slug,m.role,o.state->'organisation'->>'name' AS name,o.state->'organisation'->>'region' AS region,o.state->'operations'->>'mode' AS mode FROM memberships m JOIN organisations o ON o.id=m.organisation_id WHERE m.account_id=$1 ORDER BY o.created_at`,[actor.id])).rows
  const workspace=async(tx:Queryable,orgId:string,actor:Actor,lock=false):Promise<OrgRow>=>{
    const {rows}=await tx.query<OrgRow>(`SELECT o.id,o.slug,o.state,m.role FROM organisations o JOIN memberships m ON m.organisation_id=o.id WHERE o.id=$1 AND m.account_id=$2 ${lock?'FOR UPDATE OF o':''}`,[orgId,actor.id])
    if(!rows[0])fail(404,'Workspace was not found.')
    return rows[0]
  }
  const insertWorkspace=async(tx:Queryable,state:BusinessState,accountId:string)=>{
    const slug=state.organisation.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-'+crypto.randomUUID().slice(0,8)
    await tx.query('INSERT INTO organisations(id,slug,state) VALUES($1,$2,$3)',[state.organisation.id,slug,JSON.stringify(state)])
    await tx.query("INSERT INTO memberships(organisation_id,account_id,role) VALUES($1,$2,'owner')",[state.organisation.id,accountId])
    return slug
  }
  const persist=async(tx:Queryable,org:OrgRow,state:BusinessState,actorId:string,action:string,recordId:string)=>{
    await tx.query('UPDATE organisations SET state=$2 WHERE id=$1',[org.id,JSON.stringify(state)])
    await tx.query('INSERT INTO audit_events(id,organisation_id,actor_id,action,record_id,revision) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),org.id,actorId,action,recordId,state.revision])
  }
  const activeHolds=async(tx:Queryable,orgId:string,exclude?:string)=>(await tx.query<{id:string;input:{serviceId:string;staffId:string;date:string;startMinutes:number;resourceId:string;duration:number;buffer:number}}>('SELECT id,input FROM booking_holds WHERE organisation_id=$1 AND expires_at>now() AND appointment_id IS NULL AND id<>$2',[orgId,exclude??''])).rows
  const withHolds=async(tx:Queryable,org:OrgRow,exclude?:string)=>{
    const s=structuredClone(org.state)
    for(const h of await activeHolds(tx,org.id,exclude))s.appointments.push({id:h.id,organisationId:org.id,locationId:s.organisation.locationId,clientId:'reserved',serviceId:h.input.serviceId,staffId:h.input.staffId,resourceId:h.input.resourceId,date:h.input.date,startMinutes:h.input.startMinutes,bookedPriceMinor:0,bookedDepositMinor:0,bookedDurationMinutes:h.input.duration,bookedBufferMinutes:h.input.buffer,status:'confirmed',source:'online',createdAt:new Date().toISOString()})
    return s
  }
  app.get('/api/health',async()=>{await db.query('SELECT 1');return {ok:true,version:'0.3.0',database:db.kind}})
  app.get('/api/session',async req=>{const actor=await session(req);return {user:{id:actor.id,name:actor.name,email:actor.email},csrf:actor.csrf,workspaces:await organisations(actor)}})
  app.post('/api/auth/register',{config:{rateLimit:{max:8,timeWindow:'15 minutes'}}},async(req,reply)=>{
    const data=registration.parse(req.body),email=data.email.toLowerCase().trim(),id=crypto.randomUUID(),hash=await passwordHash(data.password)
    const result=await db.transaction(async tx=>{
      if((await tx.query('SELECT id FROM accounts WHERE email=$1',[email])).rows.length)fail(409,'An account could not be created with these details. Try signing in.')
      await tx.query('INSERT INTO accounts(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,email,data.name,hash])
      let orgId=''
      if(data.invitation) {
        const invite=(await tx.query<{organisation_id:string;email:string;role:Role}>('SELECT * FROM invitations WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE',[digest(data.invitation)])).rows[0]
        if(!invite||invite.email!==email)fail(400,'This invitation is invalid or expired.')
        await tx.query('INSERT INTO memberships(organisation_id,account_id,role) VALUES($1,$2,$3)',[invite.organisation_id,id,invite.role]);await tx.query('UPDATE invitations SET used_at=now() WHERE token_hash=$1',[digest(data.invitation)]);orgId=invite.organisation_id
      } else {
        if(!data.workspace)fail(400,'Enter your business details.')
        const state=createWorkspace(data.workspace!,data.name);await insertWorkspace(tx,state,id);orgId=state.organisation.id
      }
      return {orgId}
    })
    const csrf=await signIn(reply,id);return {...result,csrf}
  })
  app.post('/api/auth/login',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async(req,reply)=>{
    const data=loginSchema.parse(req.body)
    const account=(await db.query<{id:string;password_hash:string}>('SELECT id,password_hash FROM accounts WHERE email=$1',[data.email.trim().toLowerCase()])).rows[0]
    const valid=await checkPassword(data.password,account?.password_hash??dummyHash)
    if(!valid||!account)fail(401,'Email or password is incorrect.')
    return {csrf:await signIn(reply,account.id)}
  })
  app.post('/api/auth/demo',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(req,reply)=>{
    if(options.allowDemo===false)fail(404,'Sample workspaces are disabled.')
    const {region}=z.object({region:z.enum(['UK','US']).default('UK')}).parse(req.body)
    const id=crypto.randomUUID(),hash=await passwordHash(token())
    await db.transaction(async tx=>{await tx.query('INSERT INTO accounts(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,`sample-${id}@example.invalid`,'Maya Lewis',hash]);const state=createWorkspace({name:'Atelier House',locationName:region==='UK'?'Marylebone, London':'SoHo, New York',region,sample:true},'Maya Lewis');await insertWorkspace(tx,state,id)})
    return {csrf:await signIn(reply,id)}
  })
  app.post('/api/auth/logout',async(req,reply)=>{await session(req,true);await db.query('DELETE FROM sessions WHERE token_hash=$1',[digest(req.cookies[cookieName]!)]);reply.clearCookie(cookieName,{path:'/'});return {ok:true}})
  app.post('/api/auth/password',async(req,reply)=>{
    const actor=await session(req,true),data=z.object({current:z.string().max(128),password:z.string().min(12).max(128)}).parse(req.body)
    const account=(await db.query<{password_hash:string}>('SELECT password_hash FROM accounts WHERE id=$1',[actor.id])).rows[0]
    if(!await checkPassword(data.current,account.password_hash))fail(403,'The current password is incorrect.')
    const hash=await passwordHash(data.password)
    await db.transaction(async tx=>{await tx.query('UPDATE accounts SET password_hash=$2 WHERE id=$1',[actor.id,hash]);await tx.query('DELETE FROM sessions WHERE account_id=$1',[actor.id])})
    return {csrf:await signIn(reply,actor.id)}
  })
  app.post('/api/workspaces',async req=>{
    const actor=await session(req,true),data=z.object({workspace:workspaceInput,imported:z.unknown().optional()}).parse(req.body)
    if(data.imported&&!data.workspace.sample)fail(400,'Only sample workspaces can import browser demo data.')
    const state=createWorkspace(data.workspace,actor.name,data.imported)
    await db.transaction(tx=>insertWorkspace(tx,state,actor.id));return {orgId:state.organisation.id}
  })
  app.get<{Params:{orgId:string}}>('/api/workspaces/:orgId',async req=>{const actor=await session(req),org=await workspace(db,req.params.orgId,actor);return {...org,today:businessDate(org.state),deliveryConfigured:!!options.email}})
  app.post<{Params:{orgId:string}}>('/api/workspaces/:orgId/commands',async req=>{
    const actor=await session(req,true),body=z.object({revision:z.number().int().nonnegative(),command:commandSchema}).strict().parse(req.body)
    const key=z.string().min(8).max(150).parse(req.headers['idempotency-key']),fingerprint=digest(JSON.stringify(body.command))
    return db.transaction(async tx=>{
      const org=await workspace(tx,req.params.orgId,actor,true)
      if(!can(org.role,permissionFor(body.command)))fail(403,'Your role does not allow this action.')
      const receipt=(await tx.query<{fingerprint:string;record_id:string}>('SELECT fingerprint,record_id FROM command_receipts WHERE organisation_id=$1 AND account_id=$2 AND key=$3',[org.id,actor.id,key])).rows[0]
      if(receipt){if(receipt.fingerprint!==fingerprint)fail(409,'This request key was already used for another change.');return {ok:true,state:org.state,recordId:receipt.record_id}}
      if(org.state.revision!==body.revision)fail(409,'This workspace changed. The latest version has been loaded; review and try again.')
      const command=body.command
      if(command.type==='book'||command.type==='reschedule') {
        const blocked=await withHolds(tx,org)
        const b=command.type==='book'?command.input:{...command,serviceId:org.state.appointments.find(a=>a.id===command.appointmentId)?.serviceId??''}
        if(command.type==='reschedule')blocked.appointments=blocked.appointments.filter(a=>a.id!==command.appointmentId)
        if(!availableResource(blocked,b.serviceId,b.staffId,b.date,b.startMinutes))fail(409,'This time is reserved or unavailable. Choose another time.')
      }
      const result=dispatch(org.state,command,actor.name)
      if(!result.ok)fail(422,result.error)
      await persist(tx,org,result.state,actor.id,command.type,result.recordId)
      await tx.query('INSERT INTO command_receipts(organisation_id,account_id,key,fingerprint,record_id) VALUES($1,$2,$3,$4,$5)',[org.id,actor.id,key,fingerprint,result.recordId])
      return result
    })
  })
  app.get<{Params:{orgId:string}}>('/api/workspaces/:orgId/team',async req=>{
    const actor=await session(req);const org=await workspace(db,req.params.orgId,actor)
    if(!can(org.role,'membership'))fail(403,'Only the owner can manage access.')
    return {members:(await db.query('SELECT a.id,a.name,a.email,m.role FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.organisation_id=$1 ORDER BY a.name',[org.id])).rows,invitations:(await db.query('SELECT email,role,expires_at FROM invitations WHERE organisation_id=$1 AND used_at IS NULL AND expires_at>now()',[org.id])).rows}
  })
  app.post<{Params:{orgId:string}}>('/api/workspaces/:orgId/invitations',async req=>{
    const actor=await session(req,true),data=z.object({email:z.email(),role:z.enum(['manager','reception','practitioner'])}).parse(req.body)
    const org=await workspace(db,req.params.orgId,actor);if(!can(org.role,'membership'))fail(403,'Only the owner can invite staff.')
    const raw=token();await db.query('INSERT INTO invitations(token_hash,organisation_id,email,role,expires_at) VALUES($1,$2,$3,$4,$5)',[digest(raw),org.id,data.email.toLowerCase(),data.role,new Date(Date.now()+2*86400000)])
    return {url:`${origin}/join?invitation=${raw}`,expiresInHours:48}
  })
  app.post('/api/invitations/accept',async req=>{
    const actor=await session(req,true),data=z.object({invitation:z.string()}).parse(req.body)
    return db.transaction(async tx=>{const invite=(await tx.query<{organisation_id:string;email:string;role:string}>('SELECT * FROM invitations WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[digest(data.invitation)])).rows[0];if(!invite||invite.email!==actor.email)fail(400,'This invitation does not match your signed-in email or has expired.');await tx.query('INSERT INTO memberships(organisation_id,account_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[invite.organisation_id,actor.id,invite.role]);await tx.query('UPDATE invitations SET used_at=now() WHERE token_hash=$1',[digest(data.invitation)]);return {orgId:invite.organisation_id}})
  })
  app.post<{Params:{orgId:string}}>('/api/workspaces/:orgId/membership',async req=>{
    const actor=await session(req,true),data=z.object({accountId:z.string(),role:z.enum(['manager','reception','practitioner','remove'])}).parse(req.body)
    await db.transaction(async tx=>{const org=await workspace(tx,req.params.orgId,actor,true);if(org.role!=='owner')fail(403,'Only the owner can change access.');const member=(await tx.query<{role:string}>('SELECT role FROM memberships WHERE organisation_id=$1 AND account_id=$2',[org.id,data.accountId])).rows[0];if(!member||member.role==='owner')fail(422,'Owner access cannot be changed here.');if(data.role==='remove')await tx.query('DELETE FROM memberships WHERE organisation_id=$1 AND account_id=$2',[org.id,data.accountId]);else await tx.query('UPDATE memberships SET role=$3 WHERE organisation_id=$1 AND account_id=$2',[org.id,data.accountId,data.role])});return {ok:true}
  })
  app.get<{Params:{orgId:string}}>('/api/workspaces/:orgId/audit',async req=>{const actor=await session(req),org=await workspace(db,req.params.orgId,actor);if(!['owner','manager'].includes(org.role))fail(403,'A manager role is required.');return {events:(await db.query('SELECT e.id,e.action,e.record_id,e.revision,e.occurred_at,a.name AS actor FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.organisation_id=$1 ORDER BY e.occurred_at DESC LIMIT 200',[org.id])).rows}})
  const publicOrg=async(tx:Queryable,slug:string,lock=false)=>{
    const org=(await tx.query<OrgRow>(`SELECT id,slug,state FROM organisations WHERE slug=$1 ${lock?'FOR UPDATE':''}`,[slug])).rows[0]
    if(!org||!operations(org.state).bookingEnabled)fail(404,'Online booking is not available for this studio.')
    return org
  }
  app.get<{Params:{slug:string}}>('/api/public/:slug',async req=>{const org=await publicOrg(db,req.params.slug),s=org.state;return {organisation:s.organisation,services:s.services.filter(s=>!s.archived),staff:s.staff.filter(s=>!s.archived).map(s=>({id:s.id,name:s.name,role:s.role,serviceIds:s.serviceIds,tone:s.tone})),today:businessDate(s),sample:operations(s).mode==='sandbox'}})
  app.get<{Params:{slug:string}}>('/api/public/:slug/availability',async req=>{
    const q=z.object({serviceId:z.string(),staffId:z.string(),date:z.iso.date()}).parse(req.query)
    const org=await publicOrg(db,req.params.slug)
    return {times:slots(await withHolds(db,org),q.serviceId,q.staffId,q.date)}
  })
  app.post<{Params:{slug:string}}>('/api/public/:slug/holds',{config:{rateLimit:{max:12,timeWindow:'5 minutes'}}},async req=>{
    const data=z.object({serviceId:z.string(),staffId:z.string(),date:z.iso.date(),startMinutes:z.number().int()}).strict().parse(req.body)
    return db.transaction(async tx=>{const org=await publicOrg(tx,req.params.slug,true),s=await withHolds(tx,org),resourceId=availableResource(s,data.serviceId,data.staffId,data.date,data.startMinutes);if(!resourceId)fail(409,'That time was just taken. Please choose another.');const service=s.services.find(s=>s.id===data.serviceId)!,id=token(),expiresAt=new Date(Date.now()+5*60000).toISOString();await tx.query('INSERT INTO booking_holds(id,organisation_id,input,expires_at) VALUES($1,$2,$3,$4)',[id,org.id,JSON.stringify({...data,resourceId,duration:service.durationMinutes,buffer:service.bufferMinutes}),expiresAt]);return {hold:id,expiresAt}})
  })
  app.post<{Params:{slug:string}}>('/api/public/:slug/book',{config:{rateLimit:{max:12,timeWindow:'5 minutes'}}},async req=>{
    const data=z.object({hold:z.string().min(20),contact:z.object({name:z.string(),email:z.email(),phone:z.string(),marketingConsent:z.boolean()}),policy:z.literal(true)}).strict().parse(req.body),fingerprint=digest(JSON.stringify(data.contact))
    return db.transaction(async tx=>{
      const org=await publicOrg(tx,req.params.slug,true)
      const h=(await tx.query<{input:{serviceId:string;staffId:string;date:string;startMinutes:number};expires_at:Date;appointment_id:string|null;fingerprint:string|null}>('SELECT * FROM booking_holds WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[data.hold,org.id])).rows[0]
      if(!h)fail(409,'The reservation expired. Choose a time again.')
      if(h.appointment_id){if(h.fingerprint!==fingerprint)fail(409,'This reservation has already been used.');return {appointmentId:h.appointment_id}}
      if(new Date(h.expires_at).getTime()<Date.now())fail(409,'The reservation expired. Choose a time again.')
      const s=await withHolds(tx,org,data.hold)
      if(!availableResource(s,h.input.serviceId,h.input.staffId,h.input.date,h.input.startMinutes))fail(409,'This time is no longer available. Please choose another.')
      const result=dispatch(org.state,{type:'book',input:{serviceId:h.input.serviceId,staffId:h.input.staffId,date:h.input.date,startMinutes:h.input.startMinutes,source:'online',contact:data.contact}},'Guest booking')
      if(!result.ok)fail(422,result.error)
      await persist(tx,org,result.state,'guest','public.book',result.recordId)
      await tx.query('UPDATE booking_holds SET appointment_id=$2,fingerprint=$3 WHERE id=$1',[data.hold,result.recordId,fingerprint])
      return {appointmentId:result.recordId}
    })
  })
  app.post<{Params:{orgId:string}}>('/api/workspaces/:orgId/messages/send',async req=>{
    const actor=await session(req,true),data=z.object({id:z.string()}).parse(req.body)
    if(!options.email)fail(503,'Email delivery is not configured. Your queued message is preserved.')
    const prepared=await db.transaction(async tx=>{
      const org=await workspace(tx,req.params.orgId,actor,true);if(!can(org.role,'message.queue'))fail(403,'A manager role is required to send messages.')
      if(operations(org.state).mode==='sandbox')fail(422,'Sample workspaces never send real email.')
      const m=org.state.operations?.messages.find(m=>m.id===data.id),client=org.state.clients.find(c=>c.id===m?.clientId)
      if(!m||!client||m.status!=='queued')fail(422,'Queue this message before sending.')
      if(m.purpose==='marketing')fail(422,'Marketing delivery requires a configured unsubscribe and suppression provider. This version sends appointment messages only.')
      const attempt=digest(org.id+':'+m.id)
      await tx.query("INSERT INTO message_deliveries(organisation_id,message_id,attempt_id,status) VALUES($1,$2,$3,'sending') ON CONFLICT DO NOTHING",[org.id,m.id,attempt])
      return {orgId:org.id,message:m,to:client.email,attempt}
    })
    let providerId=''
    try {
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${options.email.key}`,'Content-Type':'application/json','Idempotency-Key':prepared.attempt},body:JSON.stringify({from:options.email.from,to:[prepared.to],subject:prepared.message.subject,text:prepared.message.body}),signal:AbortSignal.timeout(15000)})
      if(!response.ok)throw new Error('Provider rejected delivery.')
      providerId=z.object({id:z.string()}).parse(await response.json()).id
    } catch {await db.query("UPDATE message_deliveries SET status='uncertain',updated_at=now() WHERE organisation_id=$1 AND message_id=$2",[prepared.orgId,data.id]);fail(502,'Delivery was not confirmed. The same delivery key will be used on retry. Check provider records before retrying after 24 hours.')}
    await db.transaction(async tx=>{const org=await workspace(tx,prepared.orgId,actor,true),m=org.state.operations!.messages.find(m=>m.id===data.id)!;m.status='sent';m.sentAt=new Date().toISOString();m.providerId=providerId;org.state.revision++;await persist(tx,org,org.state,actor.id,'message.sent',m.id);await tx.query("UPDATE message_deliveries SET status='sent',provider_id=$3,updated_at=now() WHERE organisation_id=$1 AND message_id=$2",[org.id,m.id,providerId])})
    return {ok:true}
  })
  if(options.static) {
    await app.register(staticFiles,{root:resolve('dist'),prefix:'/'})
    app.setNotFoundHandler((req,reply)=>{if(req.url.startsWith('/api/'))return reply.code(404).send({error:'This endpoint was not found.'});reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");return reply.sendFile('index.html')})
  }
  return app
}
