// BAND APP TEST – service worker testovací verze.
// Vlastní mezipaměť s předponou band-app-test-; při aktivaci maže JEN své staré mezipaměti
// (nikdy band-app-pages-… veřejné BAND APP, i když by běžela na stejné doméně). IndexedDB ani localStorage nemaže.
// Rozsah (scope) = jen složka této testovací verze.
// 1g: přidána soukromi.html (funguje i offline), mezipaměť band-app-test-2 (stará band-app-test-1 se smaže).
const PREFIX='band-app-test-',CACHE=PREFIX+'2';
const FILES=["./","./index.html","./join.html","./soukromi.html","./friends.js","./firebase-config.js","./manifest.webmanifest","./icon-test.svg","./icon-test-192.png","./icon-test-512.png","./icon-test-maskable-512.png","./robots.txt"];
const inScope=u=>u.startsWith(self.registration.scope);
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!inScope(e.request.url))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.open(CACHE).then(c=>c.match(e.request).then(r=>r||c.match('./index.html')))))});
