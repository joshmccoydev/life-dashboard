const CACHE_NAME = "decisions-v1";
const DECISIONS_PATH = "/decisions";
const DECISIONS_CACHE_KEY = "/decisions";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function isDecisionsNavigation(request) {
  if (request.method !== "GET" || request.mode !== "navigate") {
    return false;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return false;
  }

  return (
    url.pathname === DECISIONS_PATH ||
    url.pathname.startsWith(`${DECISIONS_PATH}/`)
  );
}

async function handleDecisionsNavigation(request) {
  try {
    const response = await fetch(request);

    if (response.ok && new URL(request.url).pathname === DECISIONS_PATH) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(DECISIONS_CACHE_KEY, response.clone());
      } catch {
        // A cache write failure must not hide a live network response.
      }
    }

    return response;
  } catch {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(DECISIONS_CACHE_KEY);
      if (cachedResponse) {
        return cachedResponse;
      }
    } catch {
      // The fetch error is the final result when no cache is available.
    }

    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (!isDecisionsNavigation(event.request)) {
    return;
  }

  event.respondWith(handleDecisionsNavigation(event.request));
});
