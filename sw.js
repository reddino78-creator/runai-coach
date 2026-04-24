// BaBa School Service Worker
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch(e) { data = { title: 'BaBa School', body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'BaBa School', {
    body: data.body || '', icon: '/icon-192.png', badge: '/icon-192.png',
    silent: true, vibrate: [], tag: data.tag || 'babaschool'
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if (c.url.includes('runai-coach') && 'focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('/');
  }));
});
