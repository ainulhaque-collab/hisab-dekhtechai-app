import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { AccessError } from './identity.js';

export interface SealedKey {ciphertext:string;iv:string;tag:string;version:1}
/** Wrapping key is a separate server secret, never stored alongside ciphertext. */
export class ProviderKeyVault {
  private key:Buffer;
  constructor(wrappingKeyHex:string){
    if(!/^[a-f0-9]{64}$/i.test(wrappingKeyHex))throw new AccessError('ACCESS_NOT_CONFIGURED',503);
    this.key=Buffer.from(wrappingKeyHex,'hex');
  }
  seal(secret:string,provider:string,revision:number):SealedKey {
    if(typeof secret!=='string'||secret.length<20||secret.length>4096||/[^\x21-\x7e]/.test(secret))throw new AccessError('ACCESS_KEY_INVALID');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from(`hisab-provider:v1:${provider}:${revision}`));
    const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]).toString('hex');
    return {version:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext};
  }
  open(value:SealedKey,provider:string,revision:number):string {
    try{
      if(value.version!==1||!Number.isSafeInteger(revision)||revision<1||!/^[a-f0-9]{24}$/.test(value.iv)||!/^[a-f0-9]{32}$/.test(value.tag)||!/^(?:[a-f0-9]{2}){20,4096}$/.test(value.ciphertext))throw Error();
      const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.iv,'hex'));
      cipher.setAAD(Buffer.from(`hisab-provider:v1:${provider}:${revision}`));cipher.setAuthTag(Buffer.from(value.tag,'hex'));
      return Buffer.concat([cipher.update(Buffer.from(value.ciphertext,'hex')),cipher.final()]).toString('utf8');
    }catch{throw new AccessError('ACCESS_KEY_UNAVAILABLE',503);}
  }
}
