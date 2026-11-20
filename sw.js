// Offline support. Bump VERSION whenever app files change so phones pick up the update.
// Files are fetched past the browser's HTTP cache (GitHub Pages caches for 10 min), so a new version gets new files.
const VERSION = "fc-2026-11-20f";
const SHELL = ["index.html", "app.js", "scan.js", "logic.js", "config.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fc-") && k !== VERSION && k !== VERSION + "-ext").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only this app's folder: the Calorie Diary shares the origin and has its own worker.
  const base = new URL("./", self.location).pathname;
  if (url.origin === self.location.origin && url.pathname.startsWith(base) && !url.pathname.includes("/__")) {
    e.respondWith(caches.open(VERSION).then(async (cache) => {
      const key = req.mode === "navigate" ? "index.html" : req;
      const hit = await cache.match(key, { ignoreSearch: true });
      const net = fetch(req, { cache: "no-cache" }).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(VERSION + "-ext").then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }));
  }
  // The backend (script.google.com) always goes to the network.
});
