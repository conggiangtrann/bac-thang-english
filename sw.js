const CACHE="bacthang-v5";
const SHELL=["./","index.html","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
async function notifyIfChanged(oldRes,newRes){
  if(!oldRes)return;
  const [a,b]=await Promise.all([oldRes.clone().text(),newRes.clone().text()]);
  if(a!==b){const cs=await self.clients.matchAll();cs.forEach(c=>c.postMessage({type:"updated"}))}
}
self.addEventListener("fetch",e=>{
  const req=e.request; if(req.method!=="GET")return;
  const isPage=req.mode==="navigate";
  // Open instantly from cache; refresh from the network in the background and tell the page when lessons changed.
  e.respondWith(caches.open(CACHE).then(async c=>{
    const key=isPage?"index.html":req;
    const hit=await c.match(key,{ignoreSearch:true});
    const net=fetch(req).then(async r=>{
      if(r&&(r.ok||r.type==="opaque")){if(isPage&&r.ok)await notifyIfChanged(hit,r);await c.put(key,r.clone())}
      return r}).catch(()=>hit);
    if(hit){e.waitUntil(net.catch(()=>{}));return hit}
    return net;
  }));
});
