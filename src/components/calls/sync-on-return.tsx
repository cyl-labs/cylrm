"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Come back from Cal.com and the screen is already right.
 *
 * Moving a demo happens on Cal.com, in another tab. The worker pulls the
 * calendar every five minutes, so for up to five of them this screen goes on
 * showing the old time — with a live countdown against it, which is the part
 * that reads as broken rather than as stale. A founder rescheduled A Very Good
 * Moving Company on 2026-09-22, came straight back, and reported that the CRM
 * had not noticed; it had not yet, and four minutes later it had.
 *
 * The Refresh button already covered this, but only for somebody who knew to
 * press it. Nobody should have to know that.
 *
 * **Only after actually going to Cal.com.** It watches for a click on a link
 * to cal.com anywhere on the page, and only then does returning to the tab
 * mean anything. Syncing on every tab focus would hit a third-party API
 * because somebody glanced at their email.
 *
 * The click listener is on the capture phase so it sees the link whatever the
 * card around it does with the event, and it reads `closest("a")` rather than
 * the target, since the click usually lands on an icon or the label inside.
 */
export function SyncOnReturn() {
  const router = useRouter();
  /** Went to Cal.com, not yet come back. A ref, not state: nothing renders
   *  from it, and re-rendering on a click would be a waste. */
  const pending = React.useRef(false);
  const busy = React.useRef(false);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      const link = (e.target as HTMLElement | null)?.closest?.("a");
      const href = link?.getAttribute("href") ?? "";
      if (href.includes("cal.com")) pending.current = true;
    }

    async function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (!pending.current || busy.current) return;
      pending.current = false;
      busy.current = true;
      try {
        const res = await fetch("/api/meetings/sync", { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as {
          created?: number;
          cancelled?: number;
          throttled?: boolean;
        };
        // Refresh whatever it found: the worker may have picked the change up
        // a minute ago and this tab still would not know.
        router.refresh();
        if (data.created) {
          toast.success(
            data.created === 1
              ? "Picked up 1 new booking from Cal.com."
              : `Picked up ${data.created} bookings from Cal.com.`,
          );
        }
      } catch {
        // Silent. Nothing was promised, the Refresh button is still there,
        // and an error toast for something nobody asked for is noise.
      } finally {
        busy.current = false;
      }
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
