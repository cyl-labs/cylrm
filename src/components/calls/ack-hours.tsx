"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";

/**
 * Clears the out-of-hours notice until the next one happens.
 *
 * Not a hide: it records that this person has looked, server-side, so the
 * banner can go back to counting only what is new. The distinction is the
 * whole point — the complaint was that the notice never went away *and* that a
 * genuinely new late-night call was therefore invisible, because it changed a
 * number nobody was reading any more.
 *
 * Per person, so a caller acknowledging their own does not clear the founders'.
 */
export function AckHours({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch("/api/calls/hours-ack", { method: "POST" });
          if (!res.ok) {
            toast.error("Could not save that.");
            return;
          }
          toast.success(
            count === 1
              ? "Noted. You will hear about the next one."
              : `Noted ${count}. You will hear about the next one.`,
          );
          router.refresh();
        } catch {
          toast.error("Could not save that: network error.");
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/30 bg-card px-2.5 py-1 text-[12px] font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
    >
      <Check className="size-3.5" strokeWidth={2.4} />
      {busy ? "Saving" : "Got it"}
    </button>
  );
}
