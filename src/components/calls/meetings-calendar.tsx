import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Meeting } from "@/lib/meetings";
import { cn } from "@/lib/utils";

/**
 * The demos on a calendar, for reading the shape of a week rather than a row.
 *
 * Asked for on 2026-09-18: "even if it's like this I still need to read the
 * time." The list answers "what is next" in one glance and "how busy is
 * Saturday" in none — every row has to be read and its date held in your head.
 * A grid puts the day in the position instead, which is the whole reason
 * people were opening Cal.com to check.
 *
 * Server-rendered, and every control is a URL, for the reason `CallCalendar`
 * is: there is nothing here for the browser to do, and a link says what it is
 * showing when it is pasted to somebody.
 *
 * It is a second calendar rather than a shared one on purpose. `CallCalendar`
 * paints one number per day and links each cell into a filter; this paints
 * named appointments and links nothing, because the row underneath is where
 * anything gets done. The two share their date conventions and no markup.
 */

/** Monday first, matching `CallCalendar` and the payroll week. Two calendars
 *  in one app must not disagree about where a week begins. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Noon UTC, never midnight: a date parsed at midnight lands on the previous
 *  day in half the world, which is precisely the bug a calendar displays. */
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** Monday = 0. `getUTCDay` is Sunday = 0, which puts every grid a column out. */
const columnOf = (date: string) => (noon(date).getUTCDay() + 6) % 7;

const monthLabel = (month: string) =>
  noon(`${month}-01`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function shiftMonth(month: string, by: 1 | -1): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function daysIn(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from(
    { length: last },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** The calendar day a meeting falls on, on the reader's clock — so a demo at
 *  8am Singapore sits on Saturday for somebody reading in Singapore and on
 *  Friday for somebody reading in New York, which is what each of them means
 *  by "Saturday". */
const dayOf = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

const timeOf = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    // "10:00 AM" is two thirds punctuation in a cell this size.
    .replace(":00", "")
    .replace(" ", "");

export function MeetingsCalendar({
  month,
  meetings,
  tz,
  zoneLabel,
  today,
  query,
}: {
  /** The month being shown, YYYY-MM. */
  month: string;
  /** Every meeting the reader may see. Filtered to the month here rather than
   *  in the query: the list beside it wants the same rows, and paging a month
   *  should not cost a round trip to the database. */
  meetings: Meeting[];
  /** The reader's own clock, from the picker at the top of the screen. */
  tz: string;
  zoneLabel: string;
  /** Today on that same clock, so "today" is the reader's today. */
  today: string;
  /** The rest of the query string (the zone, the view), kept across a page
   *  turn — the bug `call-filters.tsx` documents at length. */
  query: string;
}) {
  const byDay = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = dayOf(m.startAt, tz);
    const list = byDay.get(key);
    if (list) list.push(m);
    else byDay.set(key, [m]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  const days = daysIn(month);
  const lead = columnOf(days[0]);
  const thisMonth = days.filter((d) => byDay.has(d)).length;
  const href = (m: string) => `/meetings?month=${m}${query}`;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">
          {monthLabel(month)}
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {thisMonth === 0
            ? "Nothing booked this month"
            : `${thisMonth} ${thisMonth === 1 ? "day" : "days"} with a demo · times in ${zoneLabel}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={href(shiftMonth(month, -1))}
            aria-label={`Show ${monthLabel(shiftMonth(month, -1))}`}
            className="flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" strokeWidth={2.2} />
          </Link>
          <Link
            href={href(shiftMonth(month, 1))}
            aria-label={`Show ${monthLabel(shiftMonth(month, 1))}`}
            className="flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" strokeWidth={2.2} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {/* The blanks before the first: a grid with no lead-in puts the month
            on the wrong weekday, which is the one thing a calendar must never
            do. */}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} className="min-h-[86px] border-b border-r bg-muted/20" />
        ))}
        {days.map((date, i) => {
          const rows = byDay.get(date) ?? [];
          const past = date < today;
          return (
            <div
              key={date}
              className={cn(
                "min-h-[86px] border-b border-r p-1 last:border-r-0",
                (lead + i) % 7 === 6 && "border-r-0",
                past && rows.length === 0 && "bg-muted/20",
                date === today && "bg-primary/5",
              )}
            >
              <div
                className={cn(
                  "flex items-baseline gap-1 px-1 text-[11px] font-semibold tabular-nums",
                  date === today
                    ? "text-primary"
                    : past
                      ? "text-muted-foreground/60"
                      : "text-muted-foreground",
                )}
              >
                <span>{Number(date.slice(8))}</span>
                {/* The word is dropped on a phone, where a cell is about 50px
                    and it ran straight over the next day's number. The tint
                    and the coloured date already say which day this is. */}
                {date === today && (
                  <span className="hidden truncate font-bold uppercase tracking-[0.06em] sm:inline">
                    Today
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {rows.map((m) => {
                  const off = m.status === "cancelled";
                  return (
                    <span
                      key={m.id}
                      // The whole appointment on the title, because a cell this
                      // narrow truncates the company name and the name is what
                      // somebody is scanning for.
                      title={`${timeOf(m.startAt, tz)} · ${m.company ?? m.attendeeName ?? "Demo"}${off ? " · cancelled" : ""}`}
                      className={cn(
                        "flex flex-col rounded px-1 py-0.5 text-[11px] leading-tight",
                        off
                          ? "text-muted-foreground line-through"
                          : m.startingSoon
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "bg-primary/10 text-primary font-medium",
                      )}
                    >
                      {/* Two lines, not one: on a month grid the cell is about
                          100px and "10AM Tiger Fluids Pte. Ltd." truncated to
                          "10AM TIGER F…" — the name is what somebody scans
                          for, so it gets the width to itself. */}
                      <span className="tabular-nums">{timeOf(m.startAt, tz)}</span>
                      <span className="line-clamp-2 break-words">
                        {m.company ?? m.attendeeName ?? "Demo"}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
