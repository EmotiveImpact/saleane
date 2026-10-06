import { openDatabase } from './database'
import { buildApp } from './app'
const port=Number(process.env.PORT??3001)
const origin=process.env.APP_ORIGIN??`http://127.0.0.1:${process.env.NODE_ENV==='production'?port:5173}`
const db=await openDatabase({url:process.env.DATABASE_URL,directory:process.env.SALEANE_DATA_DIR})
const app=await buildApp({db,origin,static:process.env.NODE_ENV==='production',allowDemo:process.env.ALLOW_SAMPLE_WORKSPACES!=='false',email:process.env.RESEND_API_KEY&&process.env.EMAIL_FROM?{key:process.env.RESEND_API_KEY,from:process.env.EMAIL_FROM}:undefined})
await app.listen({port,host:process.env.HOST??'127.0.0.1'})
process.stdout.write(`SALEANE server listening on ${origin} (${db.kind})\n`)
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>db.close()).then(()=>process.exit(0))})
