"use client";

import * as React from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  currentSubscription,
  pushPermission,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

/**
 * Turn browser reminders on or off for this browser.
 *
 * Per browser rather than per person, because that is what a push
 * subscription is: a caller on a laptop and a phone turns it on twice, and
 * turning it off on one leaves the other working. The label says so.
 *
 * The first-run prompt in `PushGate` is what actually gets people subscribed;
 * this is how they change their mind afterwards. Both go through
 * `lib/push-client.ts` so they cannot drift into doing different things to the
 * same subscription.
 *
 * Renders nothing where push is unsupported: an offer that cannot be accepted
 * is worse than no offer.
 */
export function PushToggle({ vapidKey }: { vapidKey?: string }) {
  const [state, setState] = React.useState<
    "loading" | "unsupported" | "ios-needs-install" | "denied" | "off" | "on"
  >("loading");
  const [busy, setBusy] = React.useState(false);

  const sync = React.useCallback(() => {
    if (!vapidKey) return setState("unsupported");

    const support = pushSupport();
    if (support !== "ok") return setState(support);
    if (pushPermission() === "denied") return setState("denied");

    currentSubscription()
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, [vapidKey]);

  React.useEffect(() => {
    sync();
    // The gate can subscribe from underneath this component, so re-read the
    // browser's answer when the tab is focused again rather than showing
    // "Remind me" next to reminders that are already on.
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, [sync]);

  async function enable() {
    if (!vapidKey || busy) return;
    setBusy(true);
    try {
      const outcome = await subscribeToPush(vapidKey);
      if (outcome === "subscribed") {
        setState("on");
        toast.success("Reminders on for this browser.");
      } else if (outcome === "denied") {
        setState("denied");
      } else {
        toast.error("Could not turn reminders on.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      if (await unsubscribeFromPush()) {
        setState("off");
        toast.success("Reminders off for this browser.");
      } else {
        toast.error("Could not turn reminders off.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;

  // Names the button by what it looks like and where it is, rather than by
  // what Apple calls it. A founder read "tap Share" on an iPhone with the
  // address bar at the top, looked in the row of buttons along the bottom
  // where every guide says it lives, and could not find it — it was beside
  // the web address the whole time. "Tap Share" only helps somebody who
  // already knows which icon that is.
  if (state === "ios-needs-install") {
    return (
      <p className="text-[13px] text-muted-foreground">
        <BellOff className="mr-1 inline size-3.5 align-[-2px]" />
        To get reminders on an iPhone, open the CRM in Safari and tap the share
        button (a box with an arrow coming out of the top, either beside the
        web address or in the row of buttons at the bottom). Choose &ldquo;Add
        to Home Screen&rdquo;, then open the CRM from that new icon: reminders
        only reach you there, never in an ordinary tab.
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
