// sw.js - Service Worker: permite instalar el CRM en Android y abre más rápido con mala señal
const CACHE = 'crm-v1';
const ARCHIVOS = ['/', '/style.css', '/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    // Los datos de clientes (/api) y otros dominios siempre van directo a internet
    if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    // Red primero; si no hay señal, usar la copia guardada
    e.respondWith(
        fetch(e.request).then((res) => {
            if (res.ok) {
                const copia = res.clone();
                caches.open(CACHE).then((c) => c.put(e.request, copia));
            }
            return res;
        }).catch(() => caches.match(e.request))
    );
});
