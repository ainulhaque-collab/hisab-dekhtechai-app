import { createHash,randomBytes } from 'node:crypto';
import { customerUuid } from '../../src/auth/customerIdentity.js';
import { AccessError,type ServiceCustomer } from './identity.js';
import { ProviderKeyVault,type SealedKey } from './vault.js';
import { AdminDirectory } from './directory.js';

export interface AccessConnection {query(sql:string,values?:unknown[]):Promise<{rows:any[]}>;release():void}
export interface AccessPool {connect():Promise<AccessConnection>}
export interface AccessStatus {customerId:string;isAdmin:boolean;blocked:boolean;active:boolean;expiresAt:string|null;serverTime:string}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=(value:unknown)=>{if(!customerUuid(value))throw new AccessError('ACCESS_REQUEST_INVALID');return value;};
const days=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>3660)throw new AccessError('ACCESS_REQUEST_INVALID');return Number(value);};
const codeDigest=(value:string)=>hash('hisab-redeem:v1:'+value);

/** Every mutation is atomic; command IDs are globally bound to actor + payload.
 * This store never reads or changes the financial ledger or shared Auth users. */
export class PostgresAccessStore {
  readonly directory:AdminDirectory;
  constructor(private pool:AccessPool,private adminId:string,private vault:ProviderKeyVault){uuid(adminId);this.directory=new AdminDirectory(pool,adminId);}
  isAdmin(customer:ServiceCustomer){return customer.customerId===this.adminId;}
  private admin(customer:ServiceCustomer){if(!this.isAdmin(customer))throw new AccessError('ACCESS_ADMIN_REQUIRED',403);}
  private async connection<T>(work:(client:AccessConnection)=>Promise<T>){const client=await this.pool.connect();try{return await work(client);}finally{client.release();}}
  private async transaction<T>(work:(client:AccessConnection)=>Promise<T>){return this.connection(async client=>{await client.query('BEGIN');try{const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}});}
  private async statusWith(client:AccessConnection,customer:ServiceCustomer):Promise<AccessStatus>{
    const {rows}=await client.query('SELECT blocked,expires_at,clock_timestamp() AS now FROM hisab_access.customers WHERE customer_id=$1',[customer.customerId]);
    const row=rows[0],now=row?.now?new Date(row.now):new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now);
    const expires=row?.expires_at?new Date(row.expires_at):null,admin=this.isAdmin(customer);
    return {customerId:customer.customerId,isAdmin:admin,blocked:!!row?.blocked,active:admin||!!(!row?.blocked&&expires&&expires>now),expiresAt:expires?.toISOString()??null,serverTime:now.toISOString()};
  }
  status(customer:ServiceCustomer){return this.connection(client=>this.statusWith(client,customer));}
  async checkRate(customer:ServiceCustomer){
    // Persistent, atomic, bounded rows (one per customer + one global). Separate
    // from AI generation quota, so reading status cannot consume a paid AI turn.
    for(const [bucket,limit] of [[customer.customerId,60],['global',10_000]] as const){
      const row=await this.connection(async client=>(await client.query("INSERT INTO hisab_access.throttles(bucket,minute,hits) VALUES($1,date_trunc('minute',clock_timestamp()),1) ON CONFLICT(bucket) DO UPDATE SET minute=excluded.minute,hits=CASE WHEN hisab_access.throttles.minute=excluded.minute THEN least(hisab_access.throttles.hits+1,100000) ELSE 1 END RETURNING hits",[bucket])).rows[0]);
      if(row.hits>limit)throw new AccessError('ACCESS_LIMIT_REACHED',429);
    }
    await this.directory.observe(customer);
  }
  async requireActive(customer:ServiceCustomer){await this.directory.observe(customer);const status=await this.status(customer);if(!status.active)throw new AccessError(status.blocked?'AI_ACCESS_BLOCKED':'AI_SUBSCRIPTION_REQUIRED',403);}
  private async command(client:AccessConnection,actor:ServiceCustomer,requestId:string,description:unknown):Promise<boolean>{
    uuid(requestId);const digest=hash(JSON.stringify(description));
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['hisab-access:'+requestId]);
    const existing=(await client.query('SELECT actor,digest FROM hisab_access.commands WHERE request_id=$1',[requestId])).rows[0];
    if(existing){if(existing.actor!==actor.customerId||existing.digest!==digest)throw new AccessError('ACCESS_REQUEST_CONFLICT',409);return false;}
    await client.query('INSERT INTO hisab_access.commands(request_id,actor,digest) VALUES($1,$2,$3)',[requestId,actor.customerId,digest]);return true;
  }
  private audit(client:AccessConnection,actor:ServiceCustomer,kind:string,subject:string|null=null){return client.query('INSERT INTO hisab_access.audit(actor,kind,subject) VALUES($1,$2,$3)',[actor.customerId,kind,subject]);}
  async issue(customer:ServiceCustomer,requestId:string,duration:unknown){
    this.admin(customer);const period=days(duration),code=randomBytes(16).toString('hex').toUpperCase();
    return this.transaction(async client=>{
      if(!await this.command(client,customer,requestId,['issue',period]))throw new AccessError('ACCESS_CODE_ALREADY_ISSUED',409);
      const {rows}=await client.query("INSERT INTO hisab_access.codes(digest,days,claim_before,issued_by,issue_request) VALUES($1,$2,now()+interval '30 days',$3,$4) RETURNING claim_before",[codeDigest(code),period,customer.customerId,requestId]);
      await this.audit(client,customer,'code_issued');return {code,days:period,claimBefore:new Date(rows[0].claim_before).toISOString()};
    });
  }
  async redeem(customer:ServiceCustomer,requestId:string,raw:unknown){
    if(typeof raw!=='string'||!/^[A-Fa-f0-9 -]{32,40}$/.test(raw))throw new AccessError('ACCESS_CODE_INVALID');
    const code=raw.replace(/[ -]/g,'').toUpperCase();if(!/^[A-F0-9]{32}$/.test(code))throw new AccessError('ACCESS_CODE_INVALID');
    return this.transaction(async client=>{
      if(!await this.command(client,customer,requestId,['redeem',codeDigest(code)]))return this.statusWith(client,customer);
      const row=(await client.query('SELECT *,claim_before>now() AS valid FROM hisab_access.codes WHERE digest=$1 FOR UPDATE',[codeDigest(code)])).rows[0];
      if(!row||!row.valid||row.claimed_by&&row.claimed_by!==customer.customerId)throw new AccessError('ACCESS_CODE_INVALID');
      if(row.claimed_by===customer.customerId)return this.statusWith(client,customer);
      await client.query('INSERT INTO hisab_access.customers(customer_id) VALUES($1) ON CONFLICT DO NOTHING',[customer.customerId]);
      const target=(await client.query('SELECT blocked FROM hisab_access.customers WHERE customer_id=$1 FOR UPDATE',[customer.customerId])).rows[0];
      if(target.blocked)throw new AccessError('AI_ACCESS_BLOCKED',403);
      await client.query("UPDATE hisab_access.customers SET expires_at=greatest(coalesce(expires_at,now()),now())+$2*interval '1 day',updated_at=now() WHERE customer_id=$1",[customer.customerId,row.days]);
      await client.query('UPDATE hisab_access.codes SET claimed_by=$2,claimed_at=now() WHERE digest=$1',[codeDigest(code),customer.customerId]);
      await this.audit(client,customer,'code_redeemed',customer.customerId);return this.statusWith(client,customer);
    });
  }
  async manage(customer:ServiceCustomer,requestId:string,target:unknown,operation:'grant'|'block'|'unblock',duration?:unknown){
    this.admin(customer);const id=uuid(target);if(id===this.adminId&&operation==='block')throw new AccessError('ACCESS_OWNER_PROTECTED',409);
    const period=operation==='grant'?days(duration):null;
    return this.transaction(async client=>{
      if(await this.command(client,customer,requestId,[operation,id,period])){
        await client.query('INSERT INTO hisab_access.customers(customer_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
        if(operation==='grant')await client.query("UPDATE hisab_access.customers SET expires_at=greatest(coalesce(expires_at,now()),now())+$2*interval '1 day',updated_at=now() WHERE customer_id=$1",[id,period]);
        else await client.query('UPDATE hisab_access.customers SET blocked=$2,updated_at=now() WHERE customer_id=$1',[id,operation==='block']);
        await this.audit(client,customer,operation==='grant'?'access_granted':operation==='block'?'blocked':'unblocked',id);
      }
      return this.statusWith(client,{customerId:id,ownerHash:''});
    });
  }
  async providerStatus(customer:ServiceCustomer){this.admin(customer);return this.connection(async client=>{
    const row=(await client.query('SELECT provider,model,revision,enabled,updated_at FROM hisab_access.providers WHERE provider=$1',['gemini'])).rows[0];
    return row?{provider:row.provider,model:row.model,revision:row.revision,enabled:row.enabled,configured:true,updatedAt:new Date(row.updated_at).toISOString()}:{provider:'gemini',model:'auto',revision:0,enabled:false,configured:false,updatedAt:null};
  });}
  async configureProvider(customer:ServiceCustomer,requestId:string,model:unknown,secret:unknown,expectedRevision:unknown){
    this.admin(customer);
    if(typeof model!=='string'||!(/^(?:auto|gemini-[a-z0-9.-]{1,100})$/.test(model))||typeof secret!=='string'||!Number.isSafeInteger(expectedRevision)||Number(expectedRevision)<0)throw new AccessError('ACCESS_REQUEST_INVALID');
    const revision=Number(expectedRevision)+1,sealed=this.vault.seal(secret,'gemini',revision);
    return this.transaction(async client=>{
      if(!await this.command(client,customer,requestId,['provider',model,hash(secret),expectedRevision]))return {saved:true};
      await client.query('SELECT pg_advisory_xact_lock(684710329)');
      const old=(await client.query("SELECT revision FROM hisab_access.providers WHERE provider='gemini'")).rows[0];
      if((old?.revision??0)!==expectedRevision)throw new AccessError('ACCESS_REVISION_CONFLICT',409);
      await client.query("INSERT INTO hisab_access.providers(provider,model,revision,enabled,sealed,updated_by) VALUES('gemini',$1,$2,true,$3,$4) ON CONFLICT(provider) DO UPDATE SET model=excluded.model,revision=excluded.revision,enabled=true,sealed=excluded.sealed,updated_by=excluded.updated_by,updated_at=now()",[model,revision,JSON.stringify(sealed),customer.customerId]);
      await this.audit(client,customer,'provider_rotated');return {saved:true};
    });
  }
  async disableProvider(customer:ServiceCustomer,requestId:string){this.admin(customer);return this.transaction(async client=>{
    if(await this.command(client,customer,requestId,['disable-provider'])){await client.query('SELECT pg_advisory_xact_lock(684710329)');await client.query("UPDATE hisab_access.providers SET enabled=false,revision=revision+1,updated_at=now(),updated_by=$1 WHERE provider='gemini'",[customer.customerId]);await this.audit(client,customer,'provider_disabled');}return {disabled:true};
  });}
  async providerConfiguration(){return this.connection(async client=>{
    const row=(await client.query("SELECT model,revision,sealed FROM hisab_access.providers WHERE provider='gemini' AND enabled=true")).rows[0];
    if(!row)throw new AccessError('AI_NOT_CONFIGURED',503);
    return {model:row.model as string,apiKey:this.vault.open(row.sealed as SealedKey,'gemini',row.revision),revision:row.revision as number};
  });}
}
