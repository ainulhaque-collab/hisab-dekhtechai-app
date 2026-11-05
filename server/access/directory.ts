import { createHash } from 'node:crypto';
import { customerUuid } from '../../src/auth/customerIdentity.js';
import { emailBatch,type AdminDirectorySnapshot } from '../../src/access/admin.js';
import { AccessError,type ServiceCustomer } from './identity.js';
import type { AccessConnection,AccessPool } from './store.js';

const date=(value:unknown)=>value?new Date(value as string).toISOString():null;
/** Email addresses locate an invitation; only fresh server-verified identity
 * can claim it. Existing entitlements always remain bound to the stable UUID. */
export class AdminDirectory {
  constructor(private pool:AccessPool,private owner:string){}
  private admin(actor:ServiceCustomer){if(actor.customerId!==this.owner)throw new AccessError('ACCESS_ADMIN_REQUIRED',403);}
  private async use<T>(work:(client:AccessConnection)=>Promise<T>){const client=await this.pool.connect();try{return await work(client);}finally{client.release();}}
  private async transaction<T>(work:(client:AccessConnection)=>Promise<T>){return this.use(async client=>{await client.query('BEGIN');try{
    // One short directory critical section also serializes simultaneous linked
    // Gmail claims. It never locks or reads a financial table.
    await client.query('SELECT pg_advisory_xact_lock(684710330)');
    const result=await work(client);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}});}
  private async command(client:AccessConnection,actor:ServiceCustomer,id:unknown,description:unknown){
    if(!customerUuid(id))throw new AccessError('ACCESS_REQUEST_INVALID');
    const digest=createHash('sha256').update(JSON.stringify(description)).digest('hex');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['hisab-access:'+id]);
    const existing=(await client.query('SELECT actor,digest FROM hisab_access.commands WHERE request_id=$1',[id])).rows[0];
    if(existing){if(existing.actor!==actor.customerId||existing.digest!==digest)throw new AccessError('ACCESS_REQUEST_CONFLICT',409);return false;}
    await client.query('INSERT INTO hisab_access.commands(request_id,actor,digest) VALUES($1,$2,$3)',[id,actor.customerId,digest]);return true;
  }
  private audit(client:AccessConnection,actor:string,kind:string,subject:string|null=null){return client.query('INSERT INTO hisab_access.directory_events(actor,kind,subject) VALUES($1,$2,$3)',[actor,kind,subject]);}
  async observe(customer:ServiceCustomer){
    if(!customer.verifiedEmails?.length)return;
    const emails=emailBatch(customer.verifiedEmails);
    await this.transaction(async client=>{
      await client.query('INSERT INTO hisab_access.customers(customer_id) VALUES($1) ON CONFLICT DO NOTHING',[customer.customerId]);
      // Replace only this customer's last observed Google contact snapshot.
      // A newly verified email may move its directory label, never ledger data,
      // existing subscription, customer UUID or Admin authority.
      await client.query('DELETE FROM hisab_access.customer_emails WHERE customer_id=$1 AND NOT(email=ANY($2::text[]))',[customer.customerId,emails]);
      await client.query('INSERT INTO hisab_access.customer_emails(email,customer_id) SELECT unnest($1::text[]),$2::uuid ON CONFLICT(email) DO UPDATE SET customer_id=excluded.customer_id,verified_at=now()',[emails,customer.customerId]);
      const target=(await client.query('SELECT blocked FROM hisab_access.customers WHERE customer_id=$1 FOR UPDATE',[customer.customerId])).rows[0];
      if(target.blocked)return; // Pending invitations cannot bypass a block.
      const grants=(await client.query('SELECT request_id,days FROM hisab_access.email_grants WHERE email=ANY($1::text[]) AND applied_at IS NULL AND cancelled_at IS NULL ORDER BY created_at,request_id FOR UPDATE',[emails])).rows;
      for(const requestId of [...new Set(grants.map(row=>row.request_id))]){
        const grant=grants.find(row=>row.request_id===requestId)!;
        const claimed=(await client.query('INSERT INTO hisab_access.email_grant_claims(request_id,customer_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING request_id',[requestId,customer.customerId])).rows.length;
        if(claimed){
          await client.query("UPDATE hisab_access.customers SET expires_at=greatest(coalesce(expires_at,now()),now())+$2*interval '1 day',updated_at=now() WHERE customer_id=$1",[customer.customerId,grant.days]);
          await this.audit(client,customer.customerId,'email_access_granted',customer.customerId);
        }
        await client.query('UPDATE hisab_access.email_grants SET customer_id=$2,applied_at=now() WHERE request_id=$1 AND email=ANY($3::text[]) AND applied_at IS NULL AND cancelled_at IS NULL',[requestId,customer.customerId,emails]);
      }
    });
  }
  async grant(actor:ServiceCustomer,id:unknown,raw:unknown,duration:unknown){
    this.admin(actor);let emails:string[];try{emails=emailBatch(raw);}catch{throw new AccessError('ACCESS_EMAILS_INVALID');}
    if(!Number.isSafeInteger(duration)||Number(duration)<1||Number(duration)>3660)throw new AccessError('ACCESS_REQUEST_INVALID');
    return this.transaction(async client=>{
      if(await this.command(client,actor,id,['email-grant',emails,duration])){
        await client.query('INSERT INTO hisab_access.email_grants(request_id,email,days) SELECT $1::uuid,unnest($2::text[]),$3::integer',[id,emails,duration]);
        await this.audit(client,actor.customerId,'email_batch_created');
      }
      return {accepted:emails.length,days:duration};
    });
  }
  async manage(actor:ServiceCustomer,id:unknown,raw:unknown,operation:unknown){
    this.admin(actor);
    if(!Array.isArray(raw)||raw.length<1||raw.length>50||raw.some(value=>!customerUuid(value))||!['block','unblock'].includes(operation as string))throw new AccessError('ACCESS_REQUEST_INVALID');
    const targets=[...new Set(raw as string[])].sort();if(operation==='block'&&targets.includes(this.owner))throw new AccessError('ACCESS_OWNER_PROTECTED',409);
    return this.transaction(async client=>{
      if(await this.command(client,actor,id,['many',operation,targets])){
        const existing=(await client.query('SELECT customer_id FROM hisab_access.customers WHERE customer_id=ANY($1::uuid[]) FOR UPDATE',[targets])).rows;
        if(existing.length!==targets.length)throw new AccessError('ACCESS_CUSTOMER_NOT_FOUND',404);
        await client.query('UPDATE hisab_access.customers SET blocked=$2,updated_at=now() WHERE customer_id=ANY($1::uuid[])',[targets,operation==='block']);
        for(const target of targets)await this.audit(client,actor.customerId,operation==='block'?'blocked':'unblocked',target);
      }return {updated:targets.length};
    });
  }
  async cancel(actor:ServiceCustomer,id:unknown,grantId:unknown,email:unknown){
    this.admin(actor);if(!customerUuid(grantId)||typeof email!=='string')throw new AccessError('ACCESS_REQUEST_INVALID');
    let normalized:string;try{[normalized]=emailBatch([email]);}catch{throw new AccessError('ACCESS_EMAILS_INVALID');}
    return this.transaction(async client=>{
      if(await this.command(client,actor,id,['cancel-email-grant',grantId,normalized])){
        const row=(await client.query('UPDATE hisab_access.email_grants SET cancelled_at=now() WHERE request_id=$1 AND email=$2 AND applied_at IS NULL AND cancelled_at IS NULL RETURNING email',[grantId,normalized])).rows[0];
        if(!row)throw new AccessError('ACCESS_REVISION_CONFLICT',409);
        await this.audit(client,actor.customerId,'email_grant_cancelled');
      }return {cancelled:true};
    });
  }
  async list(actor:ServiceCustomer,query:unknown,cursor:unknown,filter:unknown):Promise<AdminDirectorySnapshot>{
    this.admin(actor);
    if(typeof query!=='string'||query.length>254||cursor!==null&&!customerUuid(cursor)||!['all','active','expired','blocked'].includes(filter as string))throw new AccessError('ACCESS_REQUEST_INVALID');
    const search='%'+query.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%';
    return this.use(async client=>{
      const counts=(await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE NOT blocked AND expires_at>now())::int AS active,count(*) FILTER(WHERE blocked)::int AS blocked,count(*) FILTER(WHERE NOT blocked AND (expires_at IS NULL OR expires_at<=now()))::int AS expired FROM hisab_access.customers WHERE customer_id<>$1",[this.owner])).rows[0];
      counts.pending=Number((await client.query('SELECT count(*) FROM hisab_access.email_grants WHERE applied_at IS NULL AND cancelled_at IS NULL')).rows[0].count);
      const rows=(await client.query("SELECT c.customer_id,c.blocked,c.expires_at,NOT c.blocked AND coalesce(c.expires_at>now(),false) AS active,ARRAY(SELECT email FROM hisab_access.customer_emails e WHERE e.customer_id=c.customer_id ORDER BY email LIMIT 3) AS emails,(SELECT max(verified_at) FROM hisab_access.customer_emails e WHERE e.customer_id=c.customer_id) AS last_seen_at FROM hisab_access.customers c WHERE c.customer_id<>$1 AND ($2::uuid IS NULL OR c.customer_id>$2::uuid) AND ($3='%%' OR EXISTS(SELECT 1 FROM hisab_access.customer_emails e WHERE e.customer_id=c.customer_id AND e.email LIKE $3)) AND ($4='all' OR $4='blocked' AND c.blocked OR $4='active' AND NOT c.blocked AND c.expires_at>now() OR $4='expired' AND NOT c.blocked AND (c.expires_at IS NULL OR c.expires_at<=now())) ORDER BY c.customer_id LIMIT 21",[this.owner,cursor,search,filter])).rows;
      const pending=(await client.query("SELECT request_id,email,days,created_at FROM hisab_access.email_grants WHERE applied_at IS NULL AND cancelled_at IS NULL AND email LIKE $1 ORDER BY created_at DESC,email LIMIT 20",[search])).rows;
      const events=(await client.query("SELECT * FROM (SELECT 'access:'||sequence::text AS sequence,kind,subject,created_at FROM hisab_access.audit UNION ALL SELECT 'directory:'||sequence::text,kind,subject,created_at FROM hisab_access.directory_events) events ORDER BY created_at DESC,sequence DESC LIMIT 12")).rows;
      return {counts,customers:rows.slice(0,20).map(row=>({customerId:row.customer_id,emails:row.emails,blocked:row.blocked,active:row.active,expiresAt:date(row.expires_at),lastSeenAt:date(row.last_seen_at)})),pending:pending.map(row=>({requestId:row.request_id,email:row.email,days:row.days,createdAt:date(row.created_at)!})),events:events.map(row=>({sequence:row.sequence,kind:row.kind,subject:row.subject,createdAt:date(row.created_at)!})),nextCursor:rows.length>20?rows[19].customer_id:null,serverTime:new Date().toISOString()};
    });
  }
}
