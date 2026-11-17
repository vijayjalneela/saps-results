/* Demo School: offline shell. Pages always try the network first, so updates show at once;
   the saved copy is used only when there is no connection. School data is never stored here. */
const V = "ds-shell-v1";
const SHELL = ["./", "./index.html", "./tt-core.js", "./school.jpg", "./icon-192.png", "./icon-512.png", "./guide.html", "./manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  /* the Firebase SDK files are versioned, so a saved copy is safe */
  if (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/")) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); return res; })));
    return;
  }
  if (u.origin !== self.location.origin) return;            // database, logins and fonts: always live
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); } return res; })
    .catch(() => caches.match(r).then(m => m || (r.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
});
