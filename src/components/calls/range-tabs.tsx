"use client";

import * as React from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Range picker that keeps the rest of the query string.
 *
 * Rebuilding the query from scratch is the bug `call-filters.tsx` documents:
 * a select that wrote only its own parameter dropped `?list=` every time it
 * fired, quietly widening the numbers back to every niche.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-08-01" → "1 Aug 2026", from the string's own parts.
 *
 * Deliberately never builds a `Date`: `new Date("2026-08-01")` is UTC
 * midnight, which renders as 31 July once a zone east or west of it is
 * applied — and the server and the browser would disagree about which, which
 * is the hydration mismatch `leads-grid.tsx` pins its locale to avoid. A
 * calendar date has no zone, so it is formatted as text.
 */
export function formatStatsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month) return iso;
  return `${Number(d)} ${month} ${y}`;
}

/** The label on the Custom tab: one date when both ends match, otherwise the
 *  span, with the year said once when it is the same at both ends. */
export function formatStatsRange(from: string, to: string): string {
  if (from === to) return formatStatsDate(from);
  const left = formatStatsDate(from);
  const right = formatStatsDate(to);
  const [fy] = from.split("-");
  const [ty] = to.split("-");
  return fy === ty ? `${left.replace(` ${fy}`, "")} – ${right}` : `${left} – ${right}`;
}

export type CustomRange = { from: string; to: string };

/**
 * A calendar date, moved by whole days.
 *
 * Stepped in UTC for the reason `formatStatsDate` never builds a Date: a
 * calendar date has no zone, and parsing one in the browser's would land a day
 * out for anybody west of Greenwich. Midnight UTC plus N days is exact.
 */
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function RangeTabs({
  ranges,
  active,
  custom,
  today,
  day,
  zoneName = "Eastern",
}: {
  ranges: readonly { key: string; label: string }[];
  active: string;
  /** The custom range in force, or null. Passing `today` is what turns the
   *  Custom tab on at all — a screen without one keeps the plain presets. */
  custom?: CustomRange | null;
  /** Today in the reporting timezone, YYYY-MM-DD. Caps both inputs: a
   *  leaderboard running to next week is a range with nothing in the tail of
   *  it. */
  today?: string;
  /** The single day the screen is showing, when it is showing one. Turns on
   *  the arrows, which are the point: a preset list can only ever name the
   *  two days worth naming, and the day before yesterday should not need the
   *  custom dialog and two date inputs set to the same value. */
  day?: string | null;
  /** The clock those dates are cut in, for the dialog to name. Defaults to
   *  Eastern, which is what it said when there was only the one. */
  zoneName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(custom?.from ?? today ?? "");
  const [to, setTo] = React.useState(custom?.to ?? today ?? "");

  // Seeded as it opens rather than in an effect watching `open`: reopening
  // should show the range in force, not whatever was typed and abandoned last
  // time, and doing it here is one render instead of two.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setFrom(custom?.from ?? today ?? "");
      setTo(custom?.to ?? today ?? "");
    }
    setOpen(next);
  };

  function push(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`${pathname}?${next.toString()}`);
  }

  /**
   * Move the day in view by one, and land on a named preset where there is
   * one.
   *
   * Writing `range=today` rather than `day=<today's date>` matters: otherwise
   * stepping forward onto today leaves the Today tab dark and the screen
   * showing a date, which reads as a different view of the same thing. The
   * arrows and the tabs have to agree about where you are.
   */
  const stepDay = (delta: number) => {
    if (!day || !today) return;
    const next = shiftDate(day, delta);
    if (next > today) return;
    push((p) => {
      p.delete("from");
      p.delete("to");
      if (next === today) {
        p.delete("day");
        p.set("range", "today");
      } else if (next === shiftDate(today, -1)) {
        p.delete("day");
        p.set("range", "yesterday");
      } else {
        p.delete("range");
        p.set("day", next);
      }
    });
  };

  // Typed the wrong way round is a slip, not an error: the two dates are what
  // was meant either way, so they are swapped rather than refused.
  const apply = () => {
    if (!from || !to) return;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    push((next) => {
      next.delete("range");
      next.set("from", lo);
      next.set("to", hi);
    });
    setOpen(false);
  };

  return (
    // Wraps rather than overflows: with the presets held on one line, a long
    // custom label has to go somewhere, and a second row is the one option
    // that does not scroll the page sideways on a phone.
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <div className="flex shrink-0 rounded-lg border bg-card p-0.5">
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() =>
              push((next) => {
                // A preset and a custom range answer the same question two
                // ways, so setting one clears the other.
                next.delete("from");
                next.delete("to");
                next.set("range", r.key);
              })
            }
            className={cn(
              // Never wrapped: "30 days" broken over two lines makes the whole
              // header two rows tall on a phone. The custom label is the one
              // that gives, being the only part with a long string in it.
              "whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-semibold transition-colors",
              !custom && r.key === active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Only while a single day is in view. On a rolling window there is no
          day to step, and arrows that meant "shift the last 7 days back one"
          would be a second, different idea wearing the same buttons. */}
      {day && today && (
        <div className="flex shrink-0 items-center rounded-lg border bg-card p-0.5">
          <button
            type="button"
            onClick={() => stepDay(-1)}
            aria-label="Previous day"
            className="rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" strokeWidth={2.4} />
          </button>
          <span className="whitespace-nowrap px-1.5 text-[13px] font-semibold tabular-nums">
            {formatStatsDate(day)}
          </span>
          <button
            type="button"
            onClick={() => stepDay(1)}
            // Today is the end of the road. A leaderboard for tomorrow is a
            // screen of zeroes that reads as the calling having stopped.
            disabled={day >= today}
            aria-label="Next day"
            className="rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="size-4" strokeWidth={2.4} />
          </button>
        </div>
      )}

      {today !== undefined && (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] font-semibold transition-colors",
                custom
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <CalendarRange className="size-3.5 shrink-0" strokeWidth={2.4} />
              {/* The dates themselves once one is set: a tab that still said
                  "Custom" would leave the only copy of what is being measured
                  inside a dialog nobody has open. Truncated rather than
                  wrapped — this is the part that gives on a narrow screen. */}
              <span className="truncate">
                {custom ? formatStatsRange(custom.from, custom.to) : "Custom"}
              </span>
            </button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Custom dates</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="range-from">From</Label>
                <input
                  id="range-from"
                  type="date"
                  value={from}
                  max={today}
                  // Picking a start date pulls the end to match, so one day is
                  // one pick and Apply. Both fields seeded to today meant
                  // choosing a date in the past silently asked for everything
                  // from then until now, which is never what somebody picking
                  // a single date wanted. A real range is still two picks,
                  // which is what it was anyway.
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setTo(e.target.value);
                  }}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-[13px] tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="range-to">To</Label>
                <input
                  id="range-to"
                  type="date"
                  value={to}
                  max={today}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-[13px] tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            </div>

            <p className="text-[12px] text-muted-foreground">
              Both days included, cut in {zoneName} time like the rest of this
              screen.
            </p>

            <DialogFooter>
              {custom && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    push((next) => {
                      next.delete("from");
                      next.delete("to");
                      next.set("range", active);
                    });
                    setOpen(false);
                  }}
                >
                  Clear
                </Button>
              )}
              <Button onClick={apply} disabled={!from || !to}>
                Apply
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
