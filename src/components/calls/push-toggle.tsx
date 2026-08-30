"use client";

import * as React from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Turn browser reminders on for this browser.
 *
 * Per browser rather than per person, because that is what a push subscription
 * is: a caller on a laptop and a phone turns it on twice, and turning it off on
 * one leaves the other working. The button says "this browser" for that reason.
 *
 * Renders nothing at all when push is unsupported or unconfigured. An offer
 * that cannot be accepted is worse than no offer — on an iPhone that has not
 * been added to the Home Screen there is no `PushManager` at all, and the
 * honest answer there is a one-line explanation rather than a dead button.
 */
export function PushToggle({ vapidKey }: { vapidKey?: string }) {
  const [state, setState] = React.useState<
    "loading" | "unsupported" | "ios-needs-install" | "denied" | "off" | "on"
  >("loading");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!vapidKey) return setState("unsupported");
    if (typeof window === "undefined") return;

    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!supported) {
      // iOS supports push only from a Home Screen install, and reports it by
      // simply not having PushManager in a normal Safari tab. Worth telling
      // apart from "your browser cannot do this at all", because there is
      // something the person can actually do about it.
      const iOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      return setState(iOS ? "ios-needs-install" : "unsupported");
    }

    if (Notification.permission === "denied") return setState("denied");

    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, [vapidKey]);

  async function enable() {
    if (!vapidKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      // A worker registered a moment ago is not yet active, and subscribing
      // through an inactive registration throws.
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        // Required by every browser: a push that only the intended site can
        // send, rather than anyone who learns the endpoint.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("save failed");

      setState("on");
      toast.success("Reminders on for this browser.");
    } catch {
      toast.error("Could not turn reminders on.");
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Reminders off for this browser.");
    } catch {
      toast.error("Could not turn reminders off.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;

  if (state === "ios-needs-install") {
    return (
      <p className="text-[13px] text-muted-foreground">
        <BellOff className="mr-1 inline size-3.5 align-[-2px]" />
        To get reminders on an iPhone, tap Share and then &ldquo;Add to Home
        Screen&rdquo;, and open the CRM from there.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-[13px] text-muted-foreground">
        <BellOff className="mr-1 inline size-3.5 align-[-2px]" />
        Notifications are blocked for this site in your browser settings.
      </p>
    );
  }

  const on = state === "on";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={on ? disable : enable}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-50",
        on
          ? "border-success/40 text-success hover:bg-success/10"
          : "hover:bg-muted",
      )}
    >
      {on ? (
        <BellRing className="size-3.5" strokeWidth={2.2} />
      ) : (
        <Bell className="size-3.5" strokeWidth={2.2} />
      )}
      {on ? "Reminders on" : "Remind me on this browser"}
    </button>
  );
}

/**
 * The VAPID public key, as the subscribe call wants it.
 *
 * It is distributed URL-safe base64 and `atob` only reads the standard
 * alphabet, so the two substitutions and the padding are all required — get
 * this wrong and `subscribe` fails with an opaque InvalidCharacterError.
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
