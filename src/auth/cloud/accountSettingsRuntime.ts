import { AccountSettingsSession } from './accountSettingsSession';
import { takeAccountCallback } from './callbackLocation';
import { clearLegacyAccountSession, signOutAccountSessions } from './accountSignOut';

export const accountAuthEnabled=import.meta.env?.VITE_SUPABASE_AUTH_ENABLED==='true';
export const accountSettingsSession=new AccountSettingsSession({
  online:()=>navigator.onLine,
  contactChangesEnabled:import.meta.env?.VITE_ACCOUNT_CONTACT_CHANGES_ENABLED==='true',
  onCallback:()=>window.dispatchEvent(new Event('hisab-account-callback')),
  create:async receive=>{
    const [{createPlatformCloudAuth},platform,{Capacitor},{Browser}]=await Promise.all([
      import('./createPlatformAuth'),import('./platform'),import('@capacitor/core'),import('@capacitor/browser'),
    ]);
    const auth=await createPlatformCloudAuth();if(!auth)throw Error('CLOUD_AUTH_CONFIG');
    const native=Capacitor.getPlatform()==='android';
    const visibility=()=>{void(document.hidden?auth.suspend():auth.resume()).catch(()=>{});};
    let detach:()=>Promise<void>=async()=>{};
    try{
      if(native)detach=await platform.attachNativeCloudCallbacks(auth,error=>receive(error));
      if(!native){const raw=takeAccountCallback();if(raw){try{await auth.handleCallback(raw);receive();}catch(error){receive(error);}}}
      if(!native){document.addEventListener('visibilitychange',visibility);visibility();}
    }catch(error){await detach().catch(()=>{});await auth.suspend().catch(()=>{});throw error;}
    return{
      read:async()=>{const account=await auth.getCustomerAccount();if(!account)await clearLegacyAccountSession();return account;},
      changes:customerId=>auth.customerChanges(customerId),
      serviceAuthorization:customerId=>auth.serviceAuthorization(customerId),
      signIn:expected=>platform.openCloudGoogleSignIn(auth,expected),
      openLink:async url=>{if(native)await Browser.open({url});else window.location.assign(url);},
      signOut:()=>signOutAccountSessions(()=>auth.signOut()),
      close:async()=>{document.removeEventListener('visibilitychange',visibility);await detach();await auth.suspend();},
    };
  },
});
