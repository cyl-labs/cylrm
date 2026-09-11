"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Pull Telnyx now rather than waiting for the cache to lapse.
 *
 * The figures are cached for an hour because they settle daily and take
 * several seconds to fetch. That is right almost always and wrong in exactly
 * one moment: just after topping the balance up, when the number on screen is
 * the reason somebody opened the page. This is that moment's button.
 *
 * It says what it found, like the meetings refresh does — a button that looks
 * identical whether it worked or not teaches people to press it again.
 */
export function RefreshSpend() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/spend/refresh", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error ?? "Could not refresh.");
        return;
      }

      router.refresh();

      if (data.skipped === "unconfigured") {
        toast.error("Telnyx is not connected on this server.");
      } else if (data.error) {
        // The screen keeps the last good numbers, so say which half failed
        // rather than implying everything on it is now wrong.
        toast.error("Could not reach Telnyx — showing the last figures.");
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
      aria-label="Refresh spend from Telnyx"
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
