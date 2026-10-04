const CACHE_NAME = 'nuenaran-offline-v30';
const LOCAL = ['./','./index.html','./admin.html','./ceo.html','./assets/nuenaran-logo.svg'];
const REMOTE = ['https://cdn.tailwindcss.com/','https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js','https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js','https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;600;700&display=swap'];
const localURLs = new Set(LOCAL.map(path=>new URL(path,self.registration.scope).href));
const remoteURLs = new Set(REMOTE);
function assetURL(request) {
  if(request.method!=='GET')return null;
  const url=new URL(request.url);
  // No database responses, private keys, or arbitrary same-origin files.
  if(url.origin===self.location.origin){url.search='';return localURLs.has(url.href)?url.href:null;}
  if(remoteURLs.has(url.href))return url.href;
  if(url.hostname==='fonts.gstatic.com'&&request.destination==='font'&&url.protocol==='https:')return url.href;
  return null;
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL);
    await Promise.all(REMOTE.map(url=>cache.add(url).catch(()=>{})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const name of await caches.keys())if(name.startsWith('nuenaran-offline-')&&name!==CACHE_NAME)await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const key=assetURL(event.request);if(!key)return;
  const network=fetch(event.request).then(async response=>{
    if(response.ok||response.type==='opaque'){
      try{await (await caches.open(CACHE_NAME)).put(key,response.clone());}catch{}
      return response;
    }
    throw Error('Asset unavailable');
  });
  event.waitUntil(network.catch(()=>{}));
  event.respondWith((async()=>{
    const cached=await (await caches.open(CACHE_NAME)).match(key);
    if(event.request.mode==='navigate')return network.catch(()=>cached||new Response('Offline: open this page once with an internet connection.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}));
    return cached||(await network.catch(()=>Response.error()));
  })());
});
