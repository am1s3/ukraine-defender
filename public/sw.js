// ============================================================
// Ukraine Defender — Service Worker (FINAL)
// Network-first для статики → нові деплої застосовуються одразу.
// ============================================================

const CACHE = "ud-shell-v4";

const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/logo.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin (API, тайли, шрифти) — не чіпаємо.
  if (url.origin !== self.location.origin) return;

  // Навігація — network-first, fallback у кеш.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();

          caches
            .open(CACHE)
            .then((c) => c.put("/", copy))
            .catch(() => {});

          return res;
        })
        .catch(async () => {
          const cached = await caches.match("/");

          return cached || Response.error();
        })
    );

    return;
  }

  // Статика — NETWORK-FIRST, щоб новий бандл приходив одразу.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();

          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => {});
        }

        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);

        return cached || Response.error();
      })
  );
});
