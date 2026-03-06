/* ═══════════════════════════════════════════════
   R1 News Fetcher — Service Worker
   Network-first for API, cache-first for shell
   ═══════════════════════════════════════════════ */

const SHELL_CACHE = 'r1-news-shell-v42';
const ARTICLE_CACHE = 'r1-news-articles-v1';
const MAX_CACHED_ARTICLES = 10;

const SHELL_FILES = [
    './',
    './index.html',
    './main.js?v=42',
    './styles.css?v=42'
];

/* ── Install: cache app shell ── */
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force activate new worker
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_FILES))
    );
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== SHELL_CACHE && key !== ARTICLE_CACHE) {
                    return caches.delete(key);
                }
            })
        )).then(() => self.clients.claim()) // Claim clients immediately
    );
});

/* ── Fetch: network-first for API, cache-first for shell ── */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API requests: network-first, cache article responses
    if (url.pathname.includes('/article')) {
        event.respondWith(networkFirstArticle(event.request));
        return;
    }

    // Other API requests: network only (don't cache search/news results)
    if (url.href.includes('workers.dev')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Shell files: cache-first
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // Everything else: network
    event.respondWith(fetch(event.request));
});

/* ── Cache-first strategy (shell) ── */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline', { status: 503 });
    }
}

/* ── Network-first strategy (articles) ── */
async function networkFirstArticle(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(ARTICLE_CACHE);
            cache.put(request, response.clone());
            trimArticleCache();
        }
        return response;
    } catch {
        // Offline fallback: serve cached article
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(
            JSON.stringify({ error: 'Offline. This article is not cached.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

/* ── Keep only last N articles cached ── */
async function trimArticleCache() {
    const cache = await caches.open(ARTICLE_CACHE);
    const keys = await cache.keys();
    if (keys.length > MAX_CACHED_ARTICLES) {
        const toDelete = keys.slice(0, keys.length - MAX_CACHED_ARTICLES);
        await Promise.all(toDelete.map(k => cache.delete(k)));
    }
}
