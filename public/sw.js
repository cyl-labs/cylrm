/*
 * Service worker: the only thing that can show a notification when the CRM is
 * not the tab in front of somebody.
 *
 * Deliberately tiny. It caches nothing and intercepts no requests — making the
 * app work offline is a different feature with different failure modes, and a
 * caching service worker that goes wrong serves people a stale CRM, which is
 * far worse than one that does nothing.
 */

// Take over without waiting for every open tab to close, so a caller who
// turned reminders on does not have to restart their browser to get them.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  // A push with no readable payload still deserves to show something: the
  // alternative is a browser-generated "This site has been updated in the
  // background" notice, which says nothing and looks broken.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Cyllabs CRM";
  const options = {
    body: data.body || "",
    // Same tag replaces rather than stacks, so a second day's reminder does
    // not queue up behind an unread first.
    tag: data.tag || "cylrm",
    renotify: Boolean(data.tag),
    icon: "/icon.png",
    badge: "/icon.png",
    data: { url: data.url || "/meetings" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/meetings";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus a tab that already has the CRM open rather than opening a
      // second one — a caller mid-call has a dialler in one of these, and
      // navigating that tab away would drop a browser call.
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
