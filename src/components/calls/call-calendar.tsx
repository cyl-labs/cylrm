import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DayStat } from "@/lib/call-stats";
import { cn } from "@/lib/utils";

/**
 * A month of calling, as a calendar.
 *
 * It replaced a fourteen-bar chart that was always the last fourteen days
 * whatever the range above it said — so a screen filtered to one day in June
 * answered with the fortnight around today, which is the complaint this fixes.
 * A month is the shape people already think in, it pages, and the range in
 * force can be shown *inside* it: the days the numbers above cover are
 * outlined, and a single picked day is ringed.
 *
 * Server-rendered, like the chart it replaces: every control here is a URL, so
 * there is nothing for the browser to do.
 *
 * Times are Eastern throughout, `STATS_TZ` being the zone a reporting day is
 * measured in. Every date is handled as a YYYY-MM-DD string and only ever
 * turned into a `Date` at noon UTC — parsing one at midnight lands on the
 * previous day in half the world, which is exactly the bug a calendar shows.
 */

/** Monday first: the payroll week starts there, and two things in one app
 *  should not disagree about where a week begins. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** Monday = 0. `getUTCDay` is Sunday = 0, which would put every month's grid
 *  one column out. */
const columnOf = (date: string) => (noon(date).getUTCDay() + 6) % 7;

const monthLabel = (month: string) =>
  noon(`${month}-01`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** The month either side, without a Date arithmetic detour that daylight
 *  saving could reach. */
function shiftMonth(month: string, by: 1 | -1): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function CallCalendar({
  month,
  days,
  params,
  selectedDay,
  from,
  to,
  today,
  maxMonth,
}: {
  /** The month being shown, YYYY-MM. */
  month: string;
  /** Every day in it, in order — the grid depends on none being missing. */
  days: DayStat[];
  /** The filters to carry on every link here: niche, person, range, outcome.
   *  Rebuilt in full for the reason `CallFilters` does it — a control that
   *  writes its own query string drops whatever it forgot. */
  params: Record<string, string>;
  /** The day the numbers above are showing, when they are showing one. */
  selectedDay?: string;
  /** The days the range in force covers, inclusive, or undefined for all time.
   *  The days *outside* it are faded rather than the days inside being
   *  outlined: a 30-day range covers nearly every cell, so marking what is in
   *  drew a box round the whole month and said nothing. */
  from?: string;
  to?: string;
  /** Today in the reporting zone, marked so a month reads as a month rather
   *  than a grid of numbers. */
  today: string;
  /** The current month. There are no calls in the future, so paging past it
   *  is an empty grid and the arrow is not offered. */
  maxMonth: string;
}) {
  const href = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `/call-stats?${s}` : "/call-stats";
  };

  const busiest = Math.max(...days.map((d) => d.calls), 1);
  const lead = days.length > 0 ? columnOf(days[0].day) : 0;
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const total = days.reduce((sum, d) => sum + d.calls, 0);

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold tracking-[-0.01em]">
            {monthLabel(month)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/75">
            {total === 0
              ? "No calls this month. Tap a day to see just that day."
              : `${total.toLocaleString()} calls. Tap a day to see just that day.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Only offered when it goes somewhere: the current month is the
              last one that can hold a call. */}
          {month !== maxMonth && (
            <Link
              href={href({ month: maxMonth })}
              scroll={false}
              className="rounded-md px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-muted"
            >
              This month
            </Link>
          )}
          <Link
            href={href({ month: prev })}
            scroll={false}
            aria-label={`${monthLabel(prev)}`}
            className="rounded-md border p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </Link>
          {month < maxMonth ? (
            <Link
              href={href({ month: next })}
              scroll={false}
              aria-label={`${monthLabel(next)}`}
              className="rounded-md border p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span
              aria-hidden
              className="rounded-md border p-1 text-muted-foreground/30"
            >
              <ChevronRight className="size-4" />
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <span
              key={w}
              className="pb-1 text-center text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground/70"
            >
              {w}
            </span>
          ))}
          {/* The days of the previous month, left blank. A calendar that
              started every month on Monday would be a list, not a calendar. */}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} />
          ))}
          {days.map((d) => {
            const picked = selectedDay === d.day;
            // All-time covers everything, so nothing is faded.
            const outside = from && to ? d.day < from || d.day > to : false;
            // Capped well short of solid: the number sits on this, and pale
            // enough to take dark text is the same rule the Scoreboard's
            // podium follows.
            const tint = d.calls === 0 ? 0 : 0.08 + 0.27 * (d.calls / busiest);
            return (
              <Link
                key={d.day}
                // Tapping the day already showing clears back to the last 30
                // days, so the calendar is its own way out.
                href={
                  picked
                    ? href({ day: undefined, range: "30", month: undefined })
                    : href({ day: d.day, range: undefined, month: undefined })
                }
                scroll={false}
                title={`${d.day}: ${d.calls} calls, ${d.pickups} pickups`}
                className={cn(
                  "relative flex aspect-square flex-col rounded-md border p-1 transition-colors",
                  picked
                    ? "border-primary ring-1 ring-primary"
                    : "border-transparent hover:border-border",
                  // Still a link, still tappable: a day outside the range is
                  // one you might want to look at, which is the whole reason
                  // this is a calendar and not a picture of the range.
                  outside && !picked && "opacity-40",
                )}
              >
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-primary"
                  style={{ opacity: tint }}
                />
                <span className="relative flex min-h-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "text-[10px] leading-none tabular-nums",
                      d.day === today
                        ? "font-extrabold text-primary"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {Number(d.day.slice(8))}
                  </span>
                  <span className="flex flex-1 items-center justify-center text-[13px] font-bold tabular-nums">
                    {d.calls || ""}
                  </span>
                  {/* The pickup share, in the place the old chart's solid part
                      held: a day of forty calls and no pickups should not read
                      the same as a day of forty that all answered. */}
                  {d.calls > 0 && (
                    <span className="block h-[3px] w-full overflow-hidden rounded-full bg-primary/20">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(d.pickups / d.calls) * 100}%` }}
                      />
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground/75">
          Shading is how busy the day was; the bar under it is the share that
          were pickups. Faded days are outside the range above.
        </p>
      </div>
    </>
  );
}
