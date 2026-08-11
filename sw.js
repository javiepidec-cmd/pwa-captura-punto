// =========================================================================
//  SERVICE WORKER
//  Cachea la app y las librerías externas para funcionamiento offline.
//  Cambiá CACHE_VERSION cada vez que actualices archivos para forzar refresh.
// =========================================================================

const CACHE_VERSION = "captura-v1";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/@turf/turf@6/turf.min.js",
  "https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap"
];

// Instalación: cachea los assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll falla si un solo asset externo no responde, así que usamos add() individual
      return Promise.allSettled(APP_ASSETS.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

// Activación: limpia caches viejos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first para assets, network-first para el endpoint de sync
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // No cachear POST (envíos al Apps Script)
  if (event.request.method !== "GET") return;

  // Tiles de OSM: cache-first, útil para offline si ya se visitaron
  if (url.includes("tile.openstreetmap.org")) {
    event.respondWith(
      caches.open("tiles-osm").then(cache =>
        cache.match(event.request).then(hit =>
          hit || fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => hit)
        )
      )
    );
    return;
  }

  // Assets de la app: cache-first con fallback a red
  event.respondWith(
    caches.match(event.request).then((hit) => {
      return hit || fetch(event.request).then(resp => {
        // Cachear respuestas nuevas
        if (resp.ok && (url.startsWith(self.location.origin) || url.includes("unpkg.com") || url.includes("fonts.googleapis"))) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        }
        return resp;
      }).catch(() => {
        // Fallback si no hay red y no está cacheado: devolver index.html para navegación
        if (event.request.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});
