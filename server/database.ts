import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface Queryable { query<T=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:T[]}> }
export interface Database extends Queryable { transaction<T>(fn:(tx:Queryable)=>Promise<T>):Promise<T>; close():Promise<void>; kind:'embedded-postgres'|'postgres' }
export async function openDatabase(options:{url?:string;directory?:string}={}):Promise<Database> {
  if(options.url) {
    const pool=new pg.Pool({connectionString:options.url,max:10})
    return {kind:'postgres',query:async<T>(sql:string,params?:unknown[])=>({rows:(await pool.query(sql,params)).rows as T[]}),async transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn({query:async<T>(sql:string,params?:unknown[])=>({rows:(await client.query(sql,params)).rows as T[]})});await client.query('COMMIT');return result}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}},close:()=>pool.end()}
  }
  const directory=options.directory??resolve('.saleane-data/postgres')
  if(directory!=='memory://')await mkdir(directory,{recursive:true,mode:0o700})
  const db=await PGlite.create(directory)
  return {kind:'embedded-postgres',query:async<T>(sql:string,params?:unknown[])=>({rows:(await db.query<T>(sql,params)).rows}),transaction:fn=>db.transaction(tx=>fn({query:async<T>(sql:string,params?:unknown[])=>({rows:(await tx.query<T>(sql,params)).rows})})),close:()=>db.close()}
}
export async function migrate(db:Database) {
  await db.transaction(async tx=>{
    const statements=[
      `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS organisations (id text PRIMARY KEY, slug text NOT NULL UNIQUE, state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(state->'organisation'->>'id'=id))`,
      `CREATE TABLE IF NOT EXISTS memberships (organisation_id text NOT NULL REFERENCES organisations(id), account_id text NOT NULL REFERENCES accounts(id), role text NOT NULL CHECK(role IN ('owner','manager','reception','practitioner')), PRIMARY KEY(organisation_id,account_id))`,
      `CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id), csrf text NOT NULL, expires_at timestamptz NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS invitations (token_hash text PRIMARY KEY, organisation_id text NOT NULL REFERENCES organisations(id), email text NOT NULL, role text NOT NULL CHECK(role IN ('manager','reception','practitioner')), expires_at timestamptz NOT NULL, used_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS command_receipts (organisation_id text NOT NULL REFERENCES organisations(id), account_id text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, record_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organisation_id,account_id,key))`,
      `CREATE TABLE IF NOT EXISTS booking_holds (id text PRIMARY KEY, organisation_id text NOT NULL REFERENCES organisations(id), input jsonb NOT NULL, expires_at timestamptz NOT NULL, appointment_id text, fingerprint text)`,
      `CREATE INDEX IF NOT EXISTS booking_holds_scope ON booking_holds(organisation_id,expires_at)`,
      `CREATE TABLE IF NOT EXISTS audit_events (id text PRIMARY KEY, organisation_id text NOT NULL REFERENCES organisations(id), actor_id text NOT NULL, action text NOT NULL, record_id text NOT NULL, revision integer NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS message_deliveries (organisation_id text NOT NULL REFERENCES organisations(id), message_id text NOT NULL, attempt_id text NOT NULL, status text NOT NULL, provider_id text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organisation_id,message_id))`,
      `INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING`,
    ]
    for(const sql of statements)await tx.query(sql)
  })
}
