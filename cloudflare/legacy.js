// Old hostnames (LEGACY_HOSTS, comma-separated) permanently redirect to APP_ORIGIN.
// Devices that ran the app there keep its service worker, Family Code and cookies on that
// origin, so /sw.js stays a 200 (browsers refuse redirected service-worker updates) and serves
// a replacement worker that answers navigations with /moved. That page keeps the navigated
// URL, so /moved.js reads the original path from location and hands the saved code to the
// new origin's /f/<code> join page when the device opened the app root.
const HANDOFF_SW = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.clients.claim();for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.navigate(client.url).catch(()=>{});})()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch('/moved',{cache:'no-store'}));});`;
const HANDOFF_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Spellami has moved</title><script src="/moved.js"></script></head><body><p>Spellami has moved. Opening the new address…</p></body></html>`;
const handoffScript = target => `(async()=>{const target=${JSON.stringify(target)};let code='';try{code=localStorage.getItem('family-practice-code')||'';}catch{}
const path=location.pathname==='/moved'?'/':location.pathname+location.search;const safe=path.startsWith('/')&&!path.startsWith('//')?path:'/';
try{const regs=await navigator.serviceWorker?.getRegistrations?.();for(const r of regs||[])await r.unregister();}catch{}
location.replace(target+(code&&(safe==='/'||safe.startsWith('/?'))?'/f/'+encodeURIComponent(code):safe));})();`;

export function legacyHosts(env) {
  return String(env.LEGACY_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}

export function legacyResponse(request, env) {
  const url = new URL(request.url);
  if (!env.APP_ORIGIN || !legacyHosts(env).includes(url.hostname.toLowerCase())) return null;
  const target = new URL(env.APP_ORIGIN).origin;
  if (url.hostname.toLowerCase() === new URL(target).hostname) return null;
  const head = request.method === 'HEAD';
  const headers = new Headers({
    'Strict-Transport-Security': 'max-age=31536000', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  const body = (text, type, status = 200) => {
    headers.set('Content-Type', type); headers.set('Cache-Control', 'no-store');
    return new Response(head ? null : text, {status, headers});
  };
  if (url.pathname === '/sw.js') { headers.set('Service-Worker-Allowed', '/'); return body(HANDOFF_SW, 'application/javascript; charset=utf-8'); }
  if (url.pathname === '/moved') return body(HANDOFF_PAGE, 'text/html; charset=utf-8');
  if (url.pathname === '/moved.js') return body(handoffScript(target), 'application/javascript; charset=utf-8');
  // Assistant connectors keep working in place: fetch drops Authorization on cross-origin redirects.
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return null;
  if (url.pathname.startsWith('/api/')) return body(JSON.stringify({error: `Spellami has moved to ${target}. Open it there.`}), 'application/json', 410);
  headers.set('Location', target + url.pathname + url.search);
  return new Response(null, {status: 301, headers});
}
