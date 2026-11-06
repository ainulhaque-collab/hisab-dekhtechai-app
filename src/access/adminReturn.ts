interface ReturnStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const key='hisab_admin_return_v1';
function browserStorage():ReturnStorage|undefined{try{return typeof window==='undefined'?undefined:window.sessionStorage;}catch{return undefined;}}
/** Navigation hint only: neither a login credential nor authorization evidence. */
export function rememberAdminReturn(storage:ReturnStorage|undefined=browserStorage(),now=Date.now()){
  try{storage?.setItem(key,JSON.stringify({path:'/admin',issuedAt:now}));}catch{/* Login remains available without browser storage. */}
}
export function consumeAdminReturn(callbackCaptured:boolean,storage:ReturnStorage|undefined=browserStorage(),now=Date.now()):boolean{
  if(!callbackCaptured||!storage)return false;
  try{
    const raw=storage.getItem(key);storage.removeItem(key);if(!raw)return false;
    const value=JSON.parse(raw);
    return value?.path==='/admin'&&Number.isSafeInteger(value.issuedAt)&&now>=value.issuedAt&&now-value.issuedAt<=600_000;
  }catch{return false;}
}
