const CACHE_NAME = 'babaschool-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Pretendard:wght@300;400;500;600;700&display=swap'
];

// 설치
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.log('Cache install error:', err);
      });
    })
  );
  self.skipWaiting();
});

// 활성화
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 네트워크 요청 처리
self.addEventListener('fetch', event => {
  // API 요청은 캐시 안 함
  if (event.request.url.includes('/api/') ||
      event.request.url.includes('supabase.co') ||
      event.request.url.includes('strava.com') ||
      event.request.url.includes('anthropic.com') ||
      event.request.url.includes('telegram.org')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        // 오프라인 시 index.html 반환
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
