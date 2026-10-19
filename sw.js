/* R48 離線 Shell：僅儲存公開資源。絕不攔截／快取個人 API 或銀行紀錄。 */
'use strict';
const APP_CACHE='00406A-r48-shell-v1';
const DATA_CACHE='00406A-r48-public-data-v1';
const ALLOWED_CACHE_PREFIXES=['00406A-r46-','00406A-r47-','00406A-r48-'];
const SHELL=['./','./index.html','./js/auto-market.js','./js/r45-smart.js','./js/r46-mobile.js',
             './manifest.webmanifest','./icons/tracker-icon.svg','./icons/tracker-192.png','./icons/tracker-512.png'];
const PUBLIC_FEED='./data/market.json';
const CDN_HOSTS=new Set(['cdn.tailwindcss.com','cdn.jsdelivr.net']);
function isCDN(request) {
  try {
    const u=new URL(request.url);
    return CDN_HOSTS.has(u.hostname) && request.destination==='script';
  } catch (_) {return false;}
}
function isShell(url) {
  return SHELL.some(f=>new URL(f,self.registration.scope).pathname===url.pathname);
}
function feedUrl() {return new URL(PUBLIC_FEED,self.registration.scope);}
async function networkOrCached(request,cacheName,fallback) {
  const cache=await caches.open(cacheName);
  try {
    const res=await fetch(request);
    if(res && res.ok) {
      // GitHub 公開內容可離線保留；不儲存 HTTP 失敗、個人內容或非 JSON API。
      await cache.put(request,res.clone());
      return res;
    }
    const old=await cache.match(request,{ignoreSearch:true});
    return old || res;
  } catch (e) {
    const old=await cache.match(request,{ignoreSearch:true});
    if(old)return old;
    if(fallback) {
      const fallbackResponse=await cache.match(new URL('./index.html',self.registration.scope));
      if(fallbackResponse)return fallbackResponse;
    }
    throw e;
  }
}
self.addEventListener('install',event=>{
  // 不自動 skipWaiting：已有用戶的更新必須先經使用者確認。
  event.waitUntil((async()=>{
    const cache=await caches.open(APP_CACHE);
    await Promise.all(SHELL.map(async file=>{
      try {
        const u=new URL(file,self.registration.scope);
        const r=await fetch(u,{cache:'reload'});
        if(r.ok)await cache.put(u,r);
      }catch(e){console.warn('R46 首次安裝部分資源無法快取',file);}
    }));
    // 第一次安裝在線時補留公共資料。登入金鑰和私帳一律不觸碰。
    try{
      const url=feedUrl(),r=await fetch(url,{cache:'no-store'});
      if(r.ok)await (await caches.open(DATA_CACHE)).put(url,r);
    }catch(_){}
    // 供離線繪圖與版型參考：CDN 腳本如果網路失敗則不影響 SW 安裝。
    for(const url of ['https://cdn.tailwindcss.com/','https://cdn.jsdelivr.net/npm/chart.js']){
      try{const r=await fetch(url,{mode:'no-cors'});if(r)await cache.put(url,r);}catch(_){}
    }
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(k=>ALLOWED_CACHE_PREFIXES.some(p=>k.startsWith(p))&&
      k!==APP_CACHE&&k!==DATA_CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='R46_SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(isCDN(req)) {
    event.respondWith((async()=>{
      const cache=await caches.open(APP_CACHE);
      try{const result=await fetch(req);if(result)await cache.put(req,result.clone());return result;}
      catch(e){const cached=await cache.match(req);if(cached)return cached;throw e;}
    })());
    return;
  }
  if(url.origin!==self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(url.pathname===feedUrl().pathname){
    event.respondWith(networkOrCached(req,DATA_CACHE));
    return;
  }
  if(req.mode==='navigate'){
    event.respondWith(networkOrCached(req,APP_CACHE,true));
    return;
  }
  if(isShell(url))event.respondWith(networkOrCached(req,APP_CACHE));
});
