export function isShellRequest(request: Pick<Request,'url'|'method'|'mode'>, origin:string, assets:ReadonlySet<string>) {
  const url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== origin || url.search || url.hash) return false;
  return request.mode === 'navigate' ? url.pathname === '/' || url.pathname === '/index.html' : assets.has(url.pathname);
}

/** Only exact build-time static paths; never runtime media, API or auth data. */
export async function shellResponse(request:Request, cache:Cache, fetchFn:typeof fetch = fetch):Promise<Response> {
  const key = request.mode === 'navigate' ? '/index.html' : new URL(request.url).pathname;
  const cached = await cache.match(key);
  if(cached) return cached;
  // A partial/evicted cache cannot turn an error or login page into an app shell.
  return fetchFn(request);
}
export function isVersionedShellAsset(request:Pick<Request,'url'|'method'>,origin:string) {
  const url=new URL(request.url);
  return request.method==='GET'&&url.origin===origin&&!url.search&&!url.hash&&/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?)$/.test(url.pathname);
}
