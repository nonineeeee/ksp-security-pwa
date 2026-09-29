
const CACHE_NAME='ksp-security-fresh-pwa-v1-1';

const ASSETS=[
  './',
  './index.html',
  './styles.css',
  './app.js',
  './roster-import.html',
  './roster-import.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install',event=>{
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(ASSETS))
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(k=>k!==CACHE_NAME)
          .map(k=>caches.delete(k))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);

  // config.js 永遠走網路，避免 API 網址被舊 PWA 快取卡住。
  if(url.pathname.endsWith('/config.js')){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
    );
    return;
  }

  // 只處理本站 GET。
  if(event.request.method!=='GET' || url.origin!==self.location.origin){
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response=>{
        const copy=response.clone();

        caches.open(CACHE_NAME)
          .then(cache=>cache.put(event.request,copy));

        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
