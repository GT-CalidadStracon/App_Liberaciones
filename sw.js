/* Service worker del Generador de Liberaciones.
   Red primero (para recibir actualizaciones) y caché como respaldo sin señal.
   Si cambias el nombre del index.html, actualiza también ARCHIVOS y el manifest. */
var CACHE = "liberaciones-v27";
var ARCHIVOS = ["./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./logo-izq.jpg","./logo-der.png","./exceljs.min.js","./turno.js","./servidor.js"];

/* los logos son opcionales: si faltan en el servidor, la app se instala igual (sin logo) */
var OPCIONALES = ["./logo-izq.jpg","./logo-der.png"];
self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return c.addAll(ARCHIVOS.filter(function(a){ return OPCIONALES.indexOf(a)<0; })).then(function(){
      return Promise.all(OPCIONALES.map(function(a){ return c.add(a).catch(function(){}); }));
    });
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("fetch", function(e){
  if(e.request.method!=="GET" || new URL(e.request.url).origin!==location.origin) return;
  e.respondWith(fetch(e.request).then(function(r){
    if(r.ok){ var copia=r.clone(); caches.open(CACHE).then(function(c){ c.put(e.request,copia); }); }
    return r;
  }).catch(function(){ return caches.match(e.request,{ignoreSearch:true}); }));
});
