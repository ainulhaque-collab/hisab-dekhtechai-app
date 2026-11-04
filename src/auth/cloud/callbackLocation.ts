import { CLOUD_CALLBACK_PATH } from './config';
let captured:string|null=null;
let received=false;
/** Run before rendering/starting Auth requests. Keep callback codes out of history/referrers. */
export function captureAccountCallback():boolean{
  if(window.location.pathname!==CLOUD_CALLBACK_PATH)return false;
  captured=window.location.href;received=true;window.history.replaceState(null,'','/');return true;
}
export const hasAccountCallback=()=>received;
export function takeAccountCallback():string|null{const value=captured;captured=null;return value;}
