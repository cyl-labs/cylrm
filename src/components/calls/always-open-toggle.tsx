"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Moon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Keep businesses open 24 hours out of my queue.
 *
 * A stored preference rather than a link carrying a parameter, unlike the
 * "Open now" chip beside it: that one is a founder's one-off look and should
 * reset on the next navigation, while this is set once and worked with all
 * day. `app_user.hide_always_open`, written through `/api/me`, which can only
 * ever write to the account making the request.
 *
 * Labelled by what it filters to and lit when it is on, the rule the Open now
 * chip already follows — "Showing all" named the state instead, and was read
 * as the filter being applied already.
 *
 * It refreshes rather than navigating, because the queue is built on the
 * server: nothing about the current page changes except which leads come
 * back.
 */
export function AlwaysOpenToggle({ hiding }: { hiding: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function flip() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hideAlwaysOpen: !hiding }),
      });
      if (!res.ok) {
        // Said out loud, unlike the timezone picker's best-effort save. That
        // one costs a page load if it fails; this one decides which businesses
        // a caller is handed, and a switch that silently did not take would be
        // worked around by hand for the rest of the shift.
        toast.error("Could not save that. Try again.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={flip}
      disabled={saving}
      aria-pressed={hiding}
      aria-label={
        hiding
          ? "Show businesses that are open 24 hours again"
          : "Hide businesses that are open 24 hours"
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60",
        hiding
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
          : "hover:bg-muted",
      )}
    >
      <Moon className="size-4" strokeWidth={1.9} />
      {/* Dropped below `sm` like the Spreadsheet link, so it cannot push the
          "All" tab off the edge of a phone. */}
      <span className="hidden sm:inline">No 24/7</span>
    </button>
  );
}
