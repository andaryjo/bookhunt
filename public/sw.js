const CACHE_VERSION = 'v1';
const STATIC_CACHE = `bookhunt-static-${CACHE_VERSION}`;
const DATA_CACHE = `bookhunt-data-${CACHE_VERSION}`;
const MAP_CACHE = `bookhunt-map-tiles-${CACHE_VERSION}`;

const ASSETS_TO_PRECACHE = [
  '/',
  '/index.html',
  '/contribute/',
  '/contribute/index.html',
  '/css/style.css',
  '/js/utils.js',
  '/js/app.js',
  '/js/contribute.js',
  '/favicon.ico',
  '/manifest.json',
  '/images/logo.svg',
  '/images/logo-maskable.svg',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/icon-192-maskable.png',
  '/images/apple-touch-icon.png'
];

const CDN_ASSETS = [
  'https://unpkg.com/lucide@latest',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.1/dist/browser-image-compression.js',
  'https://cdn.jsdelivr.net/npm/exifr/dist/lite.umd.js',
  'https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Combine all precache targets
const PRECACHE_LIST = [...ASSETS_TO_PRECACHE, ...CDN_ASSETS];

// Max map tiles to keep in cache to prevent storage bloat (approx 4-5MB max)
const MAX_MAP_TILES = 300;

// Install Service Worker and cache all critical assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[Service Worker] Pre-caching static app shell & CDN assets');
      // We map URLs to absolute paths relative to SW's domain scope
      // to handle cases where start_url might vary (like in local tests)
      return Promise.allSettled(
        PRECACHE_LIST.map((url) => {
          return fetch(url)
            .then((response) => {
              if (response.ok) {
                return cache.put(url, response);
              }
              throw new Error(`Failed to fetch precache target: ${url}`);
            })
            .catch((err) => {
              console.warn(`[Service Worker] Skipping pre-cache for: ${url}`, err);
            });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate SW and clean up legacy caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== STATIC_CACHE &&
            cacheName !== DATA_CACHE &&
            cacheName !== MAP_CACHE
          ) {
            console.log('[Service Worker] Deleting obsolete cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper to limit the size of map tile cache
async function limitCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // Delete the oldest cached tiles (FIFO order)
    const itemsToDelete = keys.length - maxItems;
    for (let i = 0; i < itemsToDelete; i++) {
      await cache.delete(keys[i]);
    }
    console.log(`[Service Worker] Trimmed ${itemsToDelete} map tiles from cache`);
  }
}

// Intercept fetch requests and apply optimal caching strategies
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 1. Ignore non-GET requests (e.g., POST contributions)
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. OpenStreetMap Map Tiles: Cache-First (with size limit)
  if (requestUrl.host.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(MAP_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          // Serve immediately from cache, and fetch in background to keep it updated
          fetch(event.request).then((networkResponse) => {
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse);
            }
          }).catch(() => {/* Ignore offline fetch failures */});
          return cachedResponse;
        }

        // Cache miss: fetch from network
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
            // Limit cache size asynchronously
            limitCacheSize(MAP_CACHE, MAX_MAP_TILES);
          }
          return networkResponse;
        }).catch(() => {
          // Return offline placeholder tile (or let it fail silently)
          return new Response('', { status: 408, statusText: 'Network request failed' });
        });
      })
    );
    return;
  }

  // 3. Local JSON Data: Network-First with Cache Fallback
  if (requestUrl.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(DATA_CACHE).then((cache) => {
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(async () => {
            console.log(`[Service Worker] Offline fallback for data: ${requestUrl.pathname}`);
            const cachedResponse = await cache.match(event.request);
            if (cachedResponse) {
              return cachedResponse;
            }
            // If completely missing, look into the app's explicit cache
            const explicitCache = await caches.open('bookhunt-data-v1');
            const explicitResponse = await explicitCache.match(event.request);
            if (explicitResponse) {
              return explicitResponse;
            }
            return new Response(JSON.stringify({ error: 'Offline and data not cached' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
      })
    );
    return;
  }

  // 4. Static Assets & CDN libraries: Stale-While-Revalidate
  // This matches standard app shells (HTML, CSS, JS files)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok) {
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(event.request, networkResponse);
          });
        }
        return networkResponse.clone();
      }).catch(() => {/* Ignore offline network errors */});

      return cachedResponse || networkFetch;
    })
  );
});
