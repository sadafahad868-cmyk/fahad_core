const CACHE_VERSION = 'fahxd-core-v1';
const CACHE_ASSETS = [
    '/',
    '/index.html',
    '/fahad-core-mark.svg',
    '/manifest.json'
];

// Install event - cache app shell on first install
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => {
            console.log('[Service Worker] Caching app shell');
            return cache.addAll(CACHE_ASSETS);
        })
    );
    // Force the waiting service worker to become the active service worker
    self.skipWaiting();
});

// Activate event - clean up old cache versions
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_VERSION && cacheName.startsWith('fahxd-core-')) {
                        console.log(`[Service Worker] Deleting old cache: ${cacheName}`);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // Take control of all pages immediately
    self.clients.claim();
});

// Fetch event - cache-first strategy with network fallback
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip API calls - always fetch from network with fallback to error response
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Don't cache API responses
                    return response;
                })
                .catch(() => {
                    // Return error response if network is unavailable
                    return new Response(
                        JSON.stringify({
                            error: 'Network unavailable',
                            detail: 'API request failed. Check your connection.'
                        }),
                        {
                            status: 503,
                            statusText: 'Service Unavailable',
                            headers: { 'Content-Type': 'application/json' }
                        }
                    );
                })
        );
        return;
    }

    // Cache-first strategy for static assets
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then((response) => {
                // Don't cache non-successful responses
                if (!response || response.status !== 200 || response.type === 'error') {
                    return response;
                }

                // Clone the response before caching
                const responseToCache = response.clone();
                caches.open(CACHE_VERSION).then((cache) => {
                    cache.put(request, responseToCache);
                });

                return response;
            });
        })
            .catch(() => {
                // Fallback to offline page if both cache and network fail
                return caches.match('/index.html').then((response) => {
                    return response || new Response('Offline - No cached content available', { status: 503 });
                });
            })
    );
});
