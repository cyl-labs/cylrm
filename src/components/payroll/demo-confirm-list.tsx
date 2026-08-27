"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MEETING_CENTS, formatMoney } from "@/lib/payroll-rates";
import { cn } from "@/lib/utils";

export type DemoView = {
  callId: number;
  company: string;
  listName: string;
  callerName: string | null;
  bookedLabel: string;
  notes: string | null;
  showedUp: boolean | null;
};

/**
 * Did the meeting happen.
 *
 * The one fact the CRM could not already answer, and the only thing that moves
 * a caller's commission. Both answers are one tap, and either can be changed
 * until a payout claims it — after that the API refuses, because that money
 * has gone out and the fix is a correcting payout rather than an edit.
 *
 * A no-show is worth recording rather than leaving blank: it is what tells the
 * founders a booking has been dealt with, and an unanswered list that only
 * ever shrinks by half is one nobody finishes.
 */
export function DemoConfirmList({ demos }: { demos: DemoView[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<number | null>(null);

  async function mark(callId: number, showedUp: boolean) {
    setBusy(callId);
    try {
      const res = await fetch("/api/payroll/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId, showedUp }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Could not save that.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Could not save that.");
    } finally {
      setBusy(null);
    }
  }

  if (demos.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
        No booked demos waiting. Anything already paid for is in the history
        below.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {demos.map((d) => (
        <li
          key={d.callId}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{d.company}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {d.callerName ?? "Not attributed"} &middot; {d.listName} &middot;{" "}
              booked {d.bookedLabel}
            </p>
            {d.notes && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground/80">
                {d.notes}
              </p>
            )}
          </div>

          {d.showedUp !== null && (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-bold",
                d.showedUp
                  ? "bg-primary/12 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {d.showedUp
                ? `Showed up · ${formatMoney(MEETING_CENTS)}`
                : "No-show"}
            </span>
          )}

          {/* Both buttons stay after an answer, so a mis-tap is corrected by
              pressing the other one — the same shape the dialler uses, where
              logging and correcting are distinct actions. The current answer
              is the filled button. */}
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              variant={d.showedUp === true ? "default" : "outline"}
              disabled={busy === d.callId}
              onClick={() => mark(d.callId, true)}
            >
              <Check className="size-3.5" strokeWidth={2.5} />
              Showed up
            </Button>
            <Button
              size="sm"
              variant={d.showedUp === false ? "secondary" : "outline"}
              disabled={busy === d.callId}
              onClick={() => mark(d.callId, false)}
            >
              <X className="size-3.5" strokeWidth={2.5} />
              No-show
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
