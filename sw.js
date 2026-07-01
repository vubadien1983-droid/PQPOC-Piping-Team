/* sw.js -- keep the PQPOC app shell fresh WITHOUT a manual hard-refresh.
 *
 * v3: self-healing. On activate it deletes every old cache AND force-reloads any open tab
 * through this fresh SW, so a browser stuck on an older SW/cached shell recovers by itself
 * (no manual unregister / hard-refresh needed). Fetches are network-first with the HTTP cache
 * BYPASSED (cache:'no-store'), so every load is truly the latest deploy; the cached copy is
 * used only as an offline fallback. Cross-origin requests are left untouched.
 */
var CACHE = 'pqpoc-shell-v3';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      return self.clients.matchAll({ type: 'window' });
    }).then(function (cs) {
      // Force any page still on the old shell to reload through this fresh no-store SW.
      cs.forEach(function (c) { try { c.navigate(c.url); } catch (err) {} });
    }).catch(function () {})
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // cross-origin -> let the browser handle it

  e.respondWith(
    fetch(req.url, { cache: 'no-store' }).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
