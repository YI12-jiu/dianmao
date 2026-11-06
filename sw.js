/* 点卯 · 离线缓存
 * 只在 https 或 localhost 下生效；纯 IP + http 时浏览器不允许注册 Service Worker，
 * 此时页面仍可正常使用（数据在 IndexedDB），只是无法冷启动离线打开。 */
const VERSION = 'dianmao-v1.0.2';
const SHELL = [
  './',
  './index.html',
  './teacher.html',
  './student.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/css/tokens.css',
  './assets/css/login.css',
  './assets/css/app.css',
  './assets/js/config.js',
  './assets/js/db.js',
  './assets/js/auth.js',
  './assets/js/cloud.js',
  './assets/js/ui.js',
  './assets/js/login.js',
  './assets/js/teacher.js',
  './assets/js/student.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 云端接口一律走网络，不进缓存

  // 页面导航：先网络，失败回落缓存（保证离线仍能打开）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req, { ignoreSearch: true });
          return cached || (await caches.match('./index.html'));
        })
    );
    return;
  }

  // 静态资源：缓存优先，后台续期
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
