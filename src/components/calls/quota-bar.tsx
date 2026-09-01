import { Check } from "lucide-react";
import {
  WEEKLY_CALL_QUOTA,
  callsRemaining,
  quotaFraction,
} from "@/lib/call-quota";
import { cn } from "@/lib/utils";

/**
 * How far through the week's calls, on every screen.
 *
 * A strip under the header rather than a figure on one page. A caller had no
 * way to know where they stood without opening the Scoreboard and picking a
 * range, which is a feature nobody was shown, so in practice the answer was
 * "no idea until Friday". A number you have to go and look up is a number
 * nobody looks up.
 *
 * Under the header and not inside it: the header already carries the page
 * title and that page's own controls, and Stats has four of them. A full-width
 * strip is always in the same place, on every screen, at every width.
 *
 * Callers only. The founders are the ones setting the quota, and a bar telling
 * them they owe 300 calls would be furniture on every page they open.
 */
export function QuotaBar({ calls }: { calls: number }) {
  const left = callsRemaining(calls);
  const met = left === 0;
  const pct = Math.round(quotaFraction(calls) * 100);
  const over = calls - WEEKLY_CALL_QUOTA;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-2 sm:px-7">
      <p className="shrink-0 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        This week
      </p>

      <div
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        // The bar is decoration over a number that is already written out
        // beside it, so it is described once here rather than read twice.
        role="progressbar"
        aria-valuenow={calls}
        aria-valuemin={0}
        aria-valuemax={WEEKLY_CALL_QUOTA}
        aria-label={`${calls} of ${WEEKLY_CALL_QUOTA} calls this week`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            met ? "bg-success" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="shrink-0 text-[13px] tabular-nums">
        <span className="font-extrabold">{calls.toLocaleString()}</span>
        <span className="text-muted-foreground">
          {" "}
          / {WEEKLY_CALL_QUOTA.toLocaleString()}
        </span>
      </p>

      {/* The half that says what to do about it, and the half that gives on a
          narrow screen: the count above is the part worth keeping. */}
      {met ? (
        <p className="hidden shrink-0 items-center gap-1 text-[13px] font-semibold text-success sm:flex">
          <Check className="size-3.5" strokeWidth={2.6} />
          {/* Counting does not stop at the quota. Somebody who rings 340 is
              shown 340 and told the extra landed, because a bar that froze at
              300 would quietly tell the best caller their last forty did not
              count. */}
          {over > 0 ? `Quota met, +${over}` : "Quota met"}
        </p>
      ) : (
        <p className="hidden shrink-0 text-[13px] text-muted-foreground sm:block">
          {left.toLocaleString()} to go
        </p>
      )}
    </div>
  );
}
