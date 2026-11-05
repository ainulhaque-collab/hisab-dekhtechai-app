type LocalCleanup = () => Promise<void>;
let localCleanup: LocalCleanup | null = null;

/** The mounted app supplies its existing auth instance; never create a second one. */
export function registerAccountSignOutCleanup(cleanup: LocalCleanup): () => void {
  localCleanup = cleanup;
  return () => { if (localCleanup === cleanup) localCleanup = null; };
}

export async function clearLegacyAccountSession(): Promise<void> {
  if (!localCleanup) throw new Error('CLOUD_LOCAL_SIGN_OUT_FAILED');
  try { await localCleanup(); }
  catch { throw new Error('CLOUD_LOCAL_SIGN_OUT_FAILED'); }
}

/** Both credential stores must be attempted even if either cleanup fails. */
export async function signOutAccountSessions(cloud: () => Promise<{ serverRevoked: boolean }>) {
  const [remote, local] = await Promise.allSettled([
    Promise.resolve().then(cloud), clearLegacyAccountSession(),
  ]);
  if (remote.status === 'rejected') throw remote.reason;
  if (local.status === 'rejected') throw local.reason;
  return remote.value;
}
