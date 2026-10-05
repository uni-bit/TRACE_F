// Service worker for the timed photo log (/log).
// Android Chrome only shows notifications through a service worker, and a tap
// on one has to be routed back to the page from here.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "log", self.registration.scope);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, ""));
    if (open) return open.focus();
    return self.clients.openWindow(target.href);
  })());
});
