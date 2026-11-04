import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { CloudAuth } from './cloudAuth';
import { CLOUD_CALLBACK_PATH, NATIVE_CLOUD_CALLBACK } from './config';

/** Register before opening OAuth; cold launches and warm intents use the same strict handler. */
export async function attachNativeCloudCallbacks(auth: CloudAuth, onResult: (error?: Error) => void) {
  if (Capacitor.getPlatform() !== 'android') throw new Error('CLOUD_PLATFORM_UNSUPPORTED');
  const seen = new Set<string>();
  const receive = async (url: string) => {
    if (!url.startsWith(`${NATIVE_CLOUD_CALLBACK}?`)) return;
    if (seen.has(url)) return;
    seen.add(url);
    if (seen.size > 8) seen.delete(seen.values().next().value!);
    try { await auth.handleCallback(url); onResult(); }
    catch (error) { onResult(error instanceof Error ? error : new Error('CLOUD_SIGN_IN_UNAVAILABLE')); }
    finally { await Browser.close().catch(() => {}); }
  };
  const listener = await App.addListener('appUrlOpen', ({ url }) => { void receive(url); });
  let lifecycle:PluginListenerHandle|undefined;
  const detach=async()=>{await Promise.allSettled([listener.remove(),lifecycle?.remove(),auth.suspend()]);};
  try{
    lifecycle = await App.addListener('appStateChange', ({ isActive }) => {
      void (isActive ? auth.resume() : auth.suspend()).catch(() => {});
    });
    const launch = await App.getLaunchUrl();
    if (launch?.url) await receive(launch.url);
    return detach;
  }catch(error){await detach();throw error;}
}

export async function openCloudGoogleSignIn(auth: CloudAuth, expectedUserId: string | null = null) {
  const url = await auth.beginGoogleSignIn(expectedUserId);
  if (Capacitor.getPlatform() === 'android') await Browser.open({ url });
  else window.location.assign(url);
}

/** Remove the code before any async exchange/render, to keep it out of links and history. */
export async function finishWebCloudCallback(auth: CloudAuth): Promise<boolean> {
  if (window.location.pathname !== CLOUD_CALLBACK_PATH) return false;
  const callback = window.location.href;
  window.history.replaceState(null, '', '/');
  await auth.handleCallback(callback);
  return true;
}
