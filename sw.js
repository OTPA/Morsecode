const CACHE = 'morse-ear-v6';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/morse.js', 'js/trainer.js', 'js/audio.js', 'js/study.js', 'js/words.js', 'js/checks.js', 'js/coach.js', 'js/voiceparse.js', 'js/voice.js', 'js/audioedit.js', 'js/clips.js', 'js/family.js', 'js/rhythm.js', 'js/tracks.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, so the app works with no signal; refresh the cache in the background.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
