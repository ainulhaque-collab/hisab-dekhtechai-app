import type { CustomerAccount, CustomerAccountChanges, PendingCustomerChange } from '../../contracts/customerAccount';

export interface AccountSettingsRuntime {
  read(): Promise<CustomerAccount | null>;
  changes(customerId:string): CustomerAccountChanges;
  signIn(expectedCustomerId:string|null): Promise<void>;
  openLink(url:string): Promise<void>;
  signOut(): Promise<{serverRevoked:boolean}>;
  close(): Promise<void>;
}
export interface AccountSettingsState {
  phase:'loading'|'signed_out'|'connected'|'offline'|'opening'|'busy'|'error';
  account:CustomerAccount|null;
  pending:PendingCustomerChange|null;
  error:string|null;
  notice:'email_requested'|'phone_requested'|'verified'|'removed'|'cancelled'|'local_sign_out'|null;
}
const knownErrors=new Set(['CLOUD_AUTH_CONFIG','CLOUD_STORAGE_INVALID','CLOUD_STORAGE_UNAVAILABLE','CLOUD_NATIVE_UPDATE_REQUIRED',
  'CLOUD_NATIVE_RELEASE_REQUIRED','CLOUD_CALLBACK_INVALID','CLOUD_CALLBACK_EXPIRED','CLOUD_CALLBACK_UNSOLICITED','CLOUD_SIGN_IN_CANCELLED',
  'CLOUD_SIGN_IN_IN_PROGRESS','CLOUD_ACCOUNT_MISMATCH','CUSTOMER_SIGN_IN_REQUIRED','CUSTOMER_REAUTH_REQUIRED','CUSTOMER_EMAIL_INVALID',
  'CUSTOMER_PHONE_INVALID','CUSTOMER_OTP_INVALID','CUSTOMER_SMS_NOT_CONFIGURED','CUSTOMER_CHANGE_IN_PROGRESS','CUSTOMER_CHANGE_EXPIRED',
  'CUSTOMER_CHANGE_INVALID','CUSTOMER_CHANGE_UNVERIFIED','CUSTOMER_LINK_UNAVAILABLE','CUSTOMER_LAST_SIGN_IN_METHOD',
  'CUSTOMER_PRIMARY_EMAIL_CHANGE_REQUIRED','ACCOUNT_CHANGES_NOT_ENABLED']);

/** UI/session state only: no LocalDatabase, outbox, financial sync or owner adoption. */
export class AccountSettingsSession {
  private state:AccountSettingsState={phase:'loading',account:null,pending:null,error:null,notice:null};
  private listeners=new Set<()=>void>();
  private runtime:AccountSettingsRuntime|undefined;
  private initializing:Promise<void>|undefined;
  private reading:Promise<void>|undefined;
  private action:Promise<void>|undefined;
  private signingOut:Promise<void>|undefined;
  private callbackError:unknown=null;
  private refreshQueued=false;
  private epoch=0;
  readonly contactChangesEnabled:boolean;
  readonly phoneEnabled=false;
  constructor(private deps:{create:(receive:(error?:unknown)=>void)=>Promise<AccountSettingsRuntime>;online:()=>boolean;onCallback?:()=>void;contactChangesEnabled:boolean}){
    this.contactChangesEnabled=deps.contactChangesEnabled;
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(patch:Partial<AccountSettingsState>){this.state={...this.state,...patch};this.listeners.forEach(listener=>listener());}
  private fail(error:unknown){this.update({phase:this.deps.online()?'error':'offline',error:error instanceof Error&&knownErrors.has(error.message)?error.message:'CLOUD_UNAVAILABLE'});}
  start():Promise<void>{
    if(this.initializing)return this.initializing;
    const epoch=this.epoch;
    const job=(async()=>{
      try{
        const runtime=await this.deps.create(error=>{
          if(epoch!==this.epoch)return;
          this.callbackError=error??null;
          if(error)this.fail(error);else if(!this.runtime)this.refreshQueued=true;else void this.refresh();
          this.deps.onCallback?.();
        });
        if(epoch!==this.epoch){await runtime.signOut();await runtime.close();return;}
        this.runtime=runtime;await this.read(runtime,epoch);this.refreshQueued=false;
      }catch(error){if(epoch===this.epoch)this.fail(error);}
    })();this.initializing=job;
    void job.then(()=>{if(!this.runtime&&this.initializing===job)this.initializing=undefined;});return job;
  }
  private async read(runtime:AccountSettingsRuntime,epoch:number):Promise<void>{
    if(!this.deps.online()){this.update({phase:'offline',error:null});return;}
    try{
      const account=await runtime.read();
      const pending=account?await runtime.changes(account.customerId).readPendingChange():null;
      if(epoch!==this.epoch)return;
      this.update({account,pending,phase:account?'connected':this.state.phase==='opening'?'opening':'signed_out',error:null});
      if(this.callbackError)this.fail(this.callbackError);
    }catch(error){if(epoch===this.epoch)this.fail(error);}
  }
  refresh():Promise<void>{
    if(this.action){this.refreshQueued=true;return this.action;}
    if(this.reading)return this.reading;
    this.callbackError=null;
    this.reading=(async()=>{const existing=!!this.runtime;await this.start();if(existing&&this.runtime)await this.read(this.runtime,this.epoch);})().finally(()=>{this.reading=undefined;});return this.reading;
  }
  private run(work:(runtime:AccountSettingsRuntime,customerId:string|null,active:()=>boolean)=>Promise<AccountSettingsState['notice']|void>,contactChange=false):Promise<void>{
    if(this.action)return this.action;
    this.action=(async()=>{
      await this.start();if(this.reading)await this.reading;
      if(!this.deps.online()){this.update({phase:'offline',error:null});return;}
      if(contactChange&&!this.contactChangesEnabled){this.fail(Error('ACCOUNT_CHANGES_NOT_ENABLED'));return;}
      if(!this.runtime)return;
      const runtime=this.runtime,epoch=this.epoch,customerId=this.state.account?.customerId??null;
      this.update({phase:'busy',error:null,notice:null});
      try{const notice=await work(runtime,customerId,()=>epoch===this.epoch);if(epoch===this.epoch){if(notice)this.update({notice});if(this.state.phase!=='opening')await this.read(runtime,epoch);}}
      catch(error){if(epoch===this.epoch)this.fail(error);}
    })().finally(()=>{this.action=undefined;if(this.refreshQueued){this.refreshQueued=false;void this.refresh();}});return this.action;
  }
  signIn():Promise<void>{return this.run(async(runtime)=>{this.update({phase:'opening'});await runtime.signIn(null);});}
  private manager(runtime:AccountSettingsRuntime,customerId:string|null):CustomerAccountChanges{
    if(!customerId)throw Error('CUSTOMER_SIGN_IN_REQUIRED');return runtime.changes(customerId);
  }
  changeEmail(email:string):Promise<void>{return this.run(async(runtime,id)=>{await this.manager(runtime,id).requestEmailChange(email);return'email_requested';},true);}
  checkEmail():Promise<void>{return this.run(async(runtime,id)=>{const result=await this.manager(runtime,id).checkEmailChange();return result.status==='verified'?'verified':'email_requested';},true);}
  linkGoogle():Promise<void>{return this.run(async(runtime,id,active)=>{const url=await this.manager(runtime,id).beginGoogleLink();if(active())await runtime.openLink(url);},true);}
  removeGoogle(identityId:string):Promise<void>{return this.run(async(runtime,id)=>{await this.manager(runtime,id).removeGoogleIdentity(identityId);return'removed';},true);}
  cancelChange():Promise<void>{return this.run(async(runtime,id)=>{await this.manager(runtime,id).cancelPendingChange();return'cancelled';});}
  async reauthenticate():Promise<void>{
    const customerId=this.state.account?.customerId;if(!customerId)return;
    await this.signOut();await this.start();await this.run(async(runtime)=>{this.update({phase:'opening'});await runtime.signIn(customerId);});
  }
  signOut():Promise<void>{
    if(this.signingOut)return this.signingOut;
    // Invalidate reads/callbacks immediately, even when a contact change is waiting on HTTP.
    this.epoch++;this.callbackError=null;this.update({phase:'busy',error:null,notice:null});
    const runtime=this.runtime,init=this.initializing;
    const job=(async()=>{
      try{
        await init;
        const result=runtime?await runtime.signOut():{serverRevoked:false};
        if(runtime)await runtime.close();this.runtime=undefined;this.initializing=undefined;
        this.update({phase:'signed_out',account:null,pending:null,error:null,notice:result.serverRevoked?null:'local_sign_out'});
      }catch(error){this.fail(error);}
    })();this.signingOut=job.finally(()=>{this.signingOut=undefined;});return this.signingOut;
  }
}
