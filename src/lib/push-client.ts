/**
 * The browser half of push, in one place.
 *
 * Two components need it — the header toggle and the first-run prompt — and a
 * second copy of "how do we subscribe" is how they end up doing subtly
 * different things to the same subscription. No database and no server
 * imports: this only ever runs in a browser.
 */

export type PushSupport =
  | "ok"
  /** Safari on iOS exposes no PushManager in an ordinary tab, only once the
   *  site has been added to the Home Screen. Told apart from plain
   *  unsupported because it is the one case the person can act on. */
  | "ios-needs-install"
  | "unsupported";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  ) {
    return "ok";
  }
  const iOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS ? "ios-needs-install" : "unsupported";
}

export function pushPermission(): NotificationPermission | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  return Notification.permission;
}

/** The subscription this browser already holds, if any. The source of truth —
 *  a stored "we asked them" flag can be cleared, and the browser's own answer
 *  cannot. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export type SubscribeOutcome = "subscribed" | "denied" | "failed";

/**
 * Ask for permission, register the worker, subscribe, and store it.
 *
 * `denied` is separated from `failed` because they need opposite things said
 * to the person: one is a decision the browser will now remember and only
 * site settings can undo, the other is worth trying again.
 */
export async function subscribeToPush(
  vapidKey: string,
): Promise<SubscribeOutcome> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return permission === "denied" ? "denied" : "failed";
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    // A worker registered a moment ago is not yet active, and subscribing
    // through an inactive registration throws.
    await navigator.serviceWorker.ready;

    const sub = await reg.pushManager.subscribe({
      // Required by every browser: it promises the push will always show the
      // person something, rather than waking the page silently.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!res.ok) return "failed";

    return "subscribed";
  } catch {
    return "failed";
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const sub = await currentSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The VAPID public key, as `subscribe` wants it.
 *
 * It is distributed URL-safe base64 and `atob` reads only the standard
 * alphabet, so both substitutions and the padding are required — without them
 * `subscribe` fails with an opaque InvalidCharacterError.
 */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  // Built on an explicit ArrayBuffer rather than `Uint8Array.from`, whose type
  // is `Uint8Array<ArrayBufferLike>` — that admits a SharedArrayBuffer, which
  // `applicationServerKey` will not take.
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return view;
}
