"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Pull Cal.com now rather than waiting for the worker's next tick.
 *
 * Five minutes is nothing for a meeting a day away and far too long for
 * somebody who booked one a moment ago and is staring at a screen that does
 * not show it. The button exists for that gap.
 *
 * It says what it found rather than only spinning: a refresh that looks
 * identical whether it worked or not teaches people to press it again.
 */
export function RefreshMeetings() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/meetings/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error ?? "Could not refresh.");
        return;
      }

      // Re-render the server component whatever the pull found: a cancellation
      // picked up by the worker two minutes ago is still news to this tab.
      router.refresh();

      if (data.throttled) {
        toast.success("Up to date.");
      } else if (data.skipped === "unconfigured") {
        toast.error("Cal.com is not connected.");
      } else if (data.skipped === "no-event-type") {
        toast.error("No Cal.com booking link is configured.");
      } else if (data.error) {
        toast.error("Could not reach Cal.com.");
      } else if (data.created > 0) {
        toast.success(
          data.created === 1 ? "1 new meeting." : `${data.created} new meetings.`,
        );
      } else {
        toast.success("Up to date.");
      }
    } catch {
      toast.error("Could not refresh: network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={busy}
      aria-label="Refresh meetings from Cal.com"
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-60"
    >
      <RefreshCw
        className={cn("size-3.5", busy && "animate-spin")}
        strokeWidth={2.2}
      />
      {busy ? "Refreshing" : "Refresh"}
    </button>
  );
}
