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
 *
 * **Day, week and month are the same grid, not three components** (2026-09-19).
 * Each is a list of dates and a width: a month is its days with blanks in
 * front, a week is seven, a day is one. Three layouts would be three places
 * for "which day is this appointment on" to be answered differently, which is
 * the one question a calendar exists to get right.
 */

export type CalendarSpan = "day" | "week" | "month";

/** Monday first, matching `CallCalendar` and the payroll week. Two calendars
 *  in one app must not disagree about where a week begins. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Noon UTC, never midnight: a date parsed at midnight lands on the previous
 *  day in half the world, which is precisely the bug a calendar displays. */
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** Monday = 0. `getUTCDay` is Sunday = 0, which puts every grid a column out. */
const columnOf = (date: string) => (noon(date).getUTCDay() + 6) % 7;

const iso = (d: Date) => d.toISOString().slice(0, 10);

function addDays(date: string, by: number): string {
  const d = noon(date);
  d.setUTCDate(d.getUTCDate() + by);
  return iso(d);
}

/** The Monday of the week this date sits in. */
const weekStart = (date: string) => addDays(date, -columnOf(date));

function shiftMonth(month: string, by: 1 | -1): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from(
    { length: last },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** Which dates a span covers, given the date it is anchored on. */
function datesFor(span: CalendarSpan, anchor: string): string[] {
  if (span === "day") return [anchor];
  if (span === "week") {
    const start = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  return daysInMonth(anchor.slice(0, 7));
}

/**
 * The anchor one step forward or back.
 *
 * A month step lands on the first of the month rather than keeping the day of
 * the month: stepping from the 31st would otherwise have to invent a 31st of
 * February. Nothing reads the day for a month span anyway.
 */
function shift(span: CalendarSpan, anchor: string, by: 1 | -1): string {
  if (span === "day") return addDays(anchor, by);
  if (span === "week") return addDays(anchor, by * 7);
  return `${shiftMonth(anchor.slice(0, 7), by)}-01`;
}

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  noon(date).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

/** What the header calls the range in view. */
function spanLabel(span: CalendarSpan, anchor: string): string {
  if (span === "day") {
    return fmt(anchor, { weekday: "long", day: "numeric", month: "long" });
  }
  if (span === "week") {
    const days = datesFor("week", anchor);
    const a = days[0];
    const b = days[6];
    // "29 Sep – 5 Oct" when the week straddles two months, "15 – 21 Sep" when
    // it does not: repeating the month either side of the dash reads as two
    // separate dates rather than a range.
    const sameMonth = a.slice(0, 7) === b.slice(0, 7);
    return `${fmt(a, { day: "numeric", ...(sameMonth ? {} : { month: "short" }) })} – ${fmt(b, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return fmt(`${anchor.slice(0, 7)}-01`, { month: "long", year: "numeric" });
}

/** The calendar day a meeting falls on, on the reader's clock — so a demo at
 *  8am Singapore sits on Saturday for somebody reading in Singapore and on
 *  Friday for somebody reading in New York, which is what each of them means
 *  by "Saturday". */
const dayOf = (isoTime: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoTime));

const timeOf = (isoTime: string, tz: string, full = false) => {
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoTime));
  // "10:00 AM" is two thirds punctuation in a month cell. A day cell has the
  // room and reads better with the ordinary form.
  return full ? t : t.replace(":00", "").replace(" ", "");
};

export function MeetingsCalendar({
  span,
  anchor,
  meetings,
  tz,
  zoneLabel,
  today,
  query,
}: {
  /** Day, week or month. */
  span: CalendarSpan;
  /** The date the view is built around, YYYY-MM-DD. For a month only its
   *  month is read. */
  anchor: string;
  /** Every meeting the reader may see. Filtered to the range here rather than
   *  in the query: the list beside it wants the same rows, and paging should
   *  not cost a round trip to the database. */
  meetings: Meeting[];
  /** The reader's own clock, from the picker at the top of the screen. */
  tz: string;
  zoneLabel: string;
  /** Today on that same clock, so "today" is the reader's today. */
  today: string;
  /** The rest of the query string (the zone), kept across a page turn and a
   *  span change — the bug `call-filters.tsx` documents at length. */
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

  const days = datesFor(span, anchor);
  // Blanks only in front of a month. A week already starts on its Monday, and
  // a day is its own column.
  const lead = span === "month" ? columnOf(days[0]) : 0;
  const shown = days.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);
  const cols = span === "day" ? 1 : 7;

  // Every control keeps the view and the zone. The month arrows used to drop
  // `view=calendar`, so turning the page bounced the reader back to the list
  // they had just switched away from.
  const at = (s: CalendarSpan, on: string) =>
    `/meetings?view=calendar&span=${s}&on=${on}${query}`;
  const back = shift(span, anchor, -1);
  const forward = shift(span, anchor, 1);

  const SPANS: { id: CalendarSpan; label: string }[] = [
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];

  return (
    <div className="rounded-xl border bg-card">
      {/* Wraps rather than scrolls: with a span picker beside the arrows there
          is more here than a 390px header holds on one line. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-2.5">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">
          {spanLabel(span, anchor)}
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {shown === 0
            ? `Nothing booked this ${span}`
            : `${shown} ${shown === 1 ? "demo" : "demos"} · times in ${zoneLabel}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Today before the arrows: after paging three months out it is the
              way back, and hunting for it among the numbers is the thing a
              calendar without one makes you do. */}
          <Link
            href={at(span, today)}
            className="rounded-md border px-2 py-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Today
          </Link>
          <Link
            href={at(span, back)}
            aria-label={`Show ${spanLabel(span, back)}`}
            className="flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" strokeWidth={2.2} />
          </Link>
          <Link
            href={at(span, forward)}
            aria-label={`Show ${spanLabel(span, forward)}`}
            className="flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" strokeWidth={2.2} />
          </Link>
          {/* All three drawn, like the List/Calendar pair: a single button
              naming the next state has to be worked out mid-shift. */}
          <div className="flex items-center rounded-md border p-0.5">
            {SPANS.map(({ id, label }) => (
              <Link
                key={id}
                href={at(id, anchor)}
                aria-current={id === span ? "page" : undefined}
                className={cn(
                  "rounded-[5px] px-2 py-0.5 text-[13px] font-semibold transition-colors",
                  id === span
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {span !== "day" && (
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
      )}

      <div className={cn("grid", cols === 1 ? "grid-cols-1" : "grid-cols-7")}>
        {/* The blanks before the first: a grid with no lead-in puts the month
            on the wrong weekday, which is the one thing a calendar must never
            do. */}
        {Array.from({ length: lead }, (_, i) => (
          <div
            key={`lead-${i}`}
            className="min-h-[86px] border-b border-r bg-muted/20"
          />
        ))}
        {days.map((date, i) => {
          const rows = byDay.get(date) ?? [];
          const past = date < today;
          return (
            <div
              key={date}
              className={cn(
                "border-b border-r p-1 last:border-r-0",
                // A week and a day have the height a month cannot afford:
                // twelve rows of a month grid already fill a screen, while
                // seven cells or one have the room to show every appointment
                // without a "+2 more".
                span === "month"
                  ? "min-h-[86px]"
                  : span === "week"
                    ? "min-h-[150px]"
                    : "min-h-[160px]",
                (lead + i) % 7 === 6 && "border-r-0",
                cols === 1 && "border-r-0",
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
                {/* No weekday in the cell on a day view: the card's own
                    heading already reads "Saturday 19 September", and
                    repeating it gave the cell "19 SATURDAY TODAY". */}
                {/* The word is dropped on a phone, where a month cell is about
                    50px and it ran straight over the next day's number. The
                    tint and the coloured date already say which day this is. */}
                {date === today && (
                  <span
                    className={cn(
                      "truncate font-bold uppercase tracking-[0.06em]",
                      span === "month" ? "hidden sm:inline" : "inline",
                    )}
                  >
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
                      // The whole appointment on the title, because a month
                      // cell truncates the company name and the name is what
                      // somebody is scanning for.
                      title={`${timeOf(m.startAt, tz)} · ${m.company ?? m.attendeeName ?? "Demo"}${off ? " · cancelled" : ""}`}
                      className={cn(
                        "flex rounded px-1 py-0.5 leading-tight",
                        // Side by side once the cell is wide enough to hold
                        // both, which is the shape a day reads best in;
                        // stacked in a month, where ~100px truncated
                        // "10AM Tiger Fluids Pte. Ltd." to "10AM TIGER F…".
                        span === "day"
                          ? "items-baseline gap-2 text-[13px]"
                          : "flex-col text-[11px]",
                        off
                          ? "text-muted-foreground line-through"
                          : m.startingSoon
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "bg-primary/10 text-primary font-medium",
                      )}
                    >
                      <span className="shrink-0 tabular-nums">
                        {timeOf(m.startAt, tz, span === "day")}
                      </span>
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
