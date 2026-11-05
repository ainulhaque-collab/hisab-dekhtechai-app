import { useMemo,useSyncExternalStore } from 'react';
import type { AIIdentity } from '../ai/client';
import { accountAuthEnabled,accountSettingsSession } from '../auth/cloud/accountSettingsRuntime';
import { customerRequestIdentity } from './identity';

export const customerAccessEnabled=accountAuthEnabled&&import.meta.env?.VITE_CUSTOMER_ACCESS_ENABLED==='true';
export function useServiceIdentity(legacy:AIIdentity){
  const state=useSyncExternalStore(accountSettingsSession.subscribe,accountSettingsSession.getSnapshot);
  const id=state.account?.customerId??null,generation=accountSettingsSession.serviceGeneration();
  const identity=useMemo(()=>customerAccessEnabled?customerRequestIdentity(accountSettingsSession,id):legacy,[legacy,id,generation,state.phase]);
  return {identity,enabled:customerAccessEnabled,owner:identity.getProfile()?.subjectHash??''};
}
