'use strict';
// מטמון קבצי האפליקציה בלבד (קוד, לא נתונים), כדי שתעבוד גם בלי רשת.
const CACHE = 'vault-v16';
// ספריית הקריאה גדולה ולא משתנה בין גרסאות: מטמון נפרד, נשמר בשימוש הראשון
const OCR_CACHE = 'vault-ocr-7';
const FILES = ['./', 'index.html', 'style.css', 'crypto.js', 'app.js', 'layout.js', 'ocr.js', 'manifest.json', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
const store = (name, req, r) => { if (r.ok) { const c = r.clone(); caches.open(name).then(x => x.put(req, c)); } return r; };
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.includes('/vendor/')) {
    e.respondWith(caches.open(OCR_CACHE).then(c => c.match(e.request)).then(hit => hit || fetch(e.request).then(r => store(OCR_CACHE, e.request, r))));
    return;
  }
  e.respondWith(fetch(e.request).then(r => store(CACHE, e.request, r)).catch(() => caches.match(e.request)));
});
