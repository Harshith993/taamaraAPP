/* Taamara Taamara service worker: shows web push notifications and opens the app on a tap (Phase 10). */
self.addEventListener("push", (event) => {
  let data = { title: "Taamara Taamara", body: "", link: "/", tag: "taamara" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* an empty or plain push still shows something */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, tag: data.id || data.tag, icon: "/icons/icon-192.png", badge: "/icons/badge-72.png", data: { link: data.link } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL((event.notification.data && event.notification.data.link) || "/", self.location.origin);
  if (link.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if (w.url.startsWith(self.location.origin) && "focus" in w) return w.navigate(link.href).then((c) => (c || w).focus());
      return self.clients.openWindow(link.href);
    }),
  );
});
