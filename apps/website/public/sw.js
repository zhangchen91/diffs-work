/**
 * Offline support for the site.
 *
 * The hero says the site works offline; that is only true if the shell and the engines are on the
 * device. This caches them on first visit and then serves from cache, refreshing in the
 * background. Nothing the user compares is ever touched: files are read in the page and never
 * leave it, so there is nothing here to cache about them.
 *
 * Bump CACHE when the shell changes; the old cache is dropped on activation.
 */
const CACHE = "diffs-work-v1";

/** The shell is what a first offline load needs; engines are added as they are used. */
const SHELL = ["/", "/index.html", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // A missing optional asset must not fail the whole install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a deploy is picked up immediately; the cache is the fallback
  // when the network is gone.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put("/index.html", res.clone());
          return res;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match("/index.html")) ?? (await cache.match("/")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else (scripts, styles, the WASM engines, samples): cache first, refresh in the
  // background.
  //
  // The background refresh is a *revalidation*, not a re-download: sending the validator means an
  // unchanged file comes back 304 and costs nothing. Without it a cached engine (650 KB) and a
  // cached sample were fetched in full on every single request — the network panel looked busy
  // for no reason, and on a metered connection that is real traffic.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) {
        const validator = hit.headers.get("etag") ?? hit.headers.get("last-modified");
        const headers = validator ? (hit.headers.get("etag") ? { "if-none-match": validator } : { "if-modified-since": validator }) : undefined;
        void fetch(req, { headers })
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
          })
          .catch(() => {});
        return hit;
      }
      try {
        const res = await fetch(req);
        // Only same-origin, successful, non-opaque responses are worth keeping.
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      } catch (err) {
        return hit ?? Response.error();
      }
    })(),
  );
});