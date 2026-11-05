import type { LocalDatabase } from '../storage/db';
import { mobileUiEnabled } from './mobileAppearance';
const key='hisab_mobile_welcome_v1';
export function offerFirstRunWelcome(db:LocalDatabase):boolean {
  if(!mobileUiEnabled)return false;
  try{if(localStorage.getItem(key)==='seen')return false;}catch{}
  const state=db.getRawState();
  // Existing records and pending operations always open normally. This screen
  // never creates a workspace, adopts an owner, clears data or posts an entry.
  return state.journalTransactions.size===0&&state.syncOperations.size===0&&
    Array.from(state.accounts.values()).every(account=>account.openingBalanceMinor==='0');
}
export function rememberWelcomeSeen(){try{localStorage.setItem(key,'seen');}catch{}}
