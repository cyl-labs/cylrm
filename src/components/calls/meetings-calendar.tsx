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
 * **Day and week are a time grid; a month stays a grid of chips**
 * (2026-09-19). The founders asked for Google Calendar's shape — hours down
 * the side and appointments sized by how long they run — because a list of
 * start times says nothing about the *gap* between two of them, and the gap is
 * what you are looking for when you are deciding whether to squeeze a call in.
 * A month cell is about 100px and cannot hold an hour ruler, which is why
 * Google's month view does not either.
 */

export type CalendarSpan = "day" | "week" | "month" | "next24";

/** How far the rolling window runs. */
const NEXT_HOURS = 24;

/** Monday first, matching `CallCalendar` and the payroll week. Two calendars
 *  in one app must not disagree about where a week begins. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * One hour of the time grid.
 *
 * 64 rather than 48 because **a Cal.com demo is thirty minutes**, and at 48
 * that block is 24px — two lines of 11px text need about 30, so every real
 * booking on prod rendered as "2AM · D…" with its top clipped. The seeded
 * hour-long test bookings hid it completely. A tall grid is the price of the
 * common case being legible.
 */
const HOUR_PX = 64;
/** The time gutter. Fits "12 AM" at 11px without wrapping. */
const GUTTER = "w-12 sm:w-14";
/** An appointment with no end time. Cal.com always sends one; this is for the
 *  rows that predate the column. */
const DEFAULT_MINUTES = 30;
/** Never smaller than this, or a 15-minute call is unreadable. Shorter
 *  bookings than half an hour therefore run a little into the slot below,
 *  which is what Google does with them too. */
const MIN_BLOCK_PX = 30;

/** Noon UTC, never midnight: a date parsed at midnight lands on the previous
 *  day in half the world, which is precisely the bug a calendar displays. */
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** Monday = 0. `getUTCDay` is Sunday = 0, which puts every grid a column out. */
const columnOf = (date: string) => (noon(date).getUTCDay() + 6) % 7;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function addDays(date: string, by: number): string {
  const d = noon(date);
  d.setUTCDate(d.getUTCDate() + by);
  return isoDate(d);
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
  // "10:00 AM" is two thirds punctuation in a month cell. The time grid has
  // the room and reads better with the ordinary form.
  return full ? t : t.replace(":00", "").replace(" ", "");
};

/** Minutes past midnight, on the reader's clock. `h23` rather than
 *  `hour12: false`, which renders midnight as 24 in some engines and would put
 *  a midnight demo off the bottom of the day. */
function minutesOf(isoTime: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoTime));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const hourLabel = (hour: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;

/** What a meeting is, said rather than left to a colour. */
const kindLabel = (m: Meeting) =>
  m.kind === "follow_up" ? "Follow-up" : "Demo";

const nameOf = (m: Meeting) => m.company ?? m.attendeeName ?? "Demo";

/**
 * Where each appointment sits in its day, and how wide.
 *
 * Two demos at the same hour must not hide one another, so overlapping ones
 * are dealt columns — the same thing Google Calendar does. The width is per
 * *cluster* of overlaps rather than per day: one clash at 9am should not
 * halve the width of an untroubled 4pm call.
 */
type Placed = {
  m: Meeting;
  start: number;
  end: number;
  col: number;
  cols: number;
};

/** How long a booking runs, in minutes. */
const lengthOf = (m: Meeting) =>
  m.endAt
    ? Math.max(
        15,
        Math.round(
          (new Date(m.endAt).getTime() - new Date(m.startAt).getTime()) / 60000,
        ),
      )
    : DEFAULT_MINUTES;

/**
 * Deal overlapping appointments into columns.
 *
 * Split out from `place` so the rolling next-24-hours strip can use it too:
 * that one measures from the current hour rather than from midnight, and the
 * packing is the only part the two have in common. One copy, because two
 * would be two answers to "do these two clash".
 */
function assignColumns(items: Placed[]): Placed[] {
  items.sort((a, b) => a.start - b.start || a.end - b.end);
  const ends: number[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const close = () => {
    const width = Math.max(...cluster.map((i) => i.col)) + 1;
    for (const i of cluster) i.cols = width;
    cluster = [];
    ends.length = 0;
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) close();
    let c = ends.findIndex((end) => end <= it.start);
    if (c === -1) {
      c = ends.length;
      ends.push(it.end);
    } else {
      ends[c] = it.end;
    }
    it.col = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) close();
  return items;
}

/** One day's appointments, measured from its own midnight. */
function place(rows: Meeting[], tz: string): Placed[] {
  return assignColumns(
    rows.map((m) => {
      const start = minutesOf(m.startAt, tz);
      // Clamped to the end of the day: a booking that runs past midnight
      // belongs to tomorrow's column as well, and drawing it off the bottom of
      // this one would stretch the grid instead.
      return {
        m,
        start,
        end: Math.min(start + lengthOf(m), 24 * 60),
        col: 0,
        cols: 1,
      };
    }),
  );
}

/** The same, measured in minutes from a moment — the rolling window's start.
 *  Midnight is just another line here, which is the entire point of it. */
function placeFrom(rows: Meeting[], startMs: number, minutes: number): Placed[] {
  return assignColumns(
    rows.map((m) => {
      const start = (new Date(m.startAt).getTime() - startMs) / 60000;
      return {
        m,
        start,
        end: Math.min(start + lengthOf(m), minutes),
        col: 0,
        cols: 1,
      };
    }),
  );
}

/** A folded stretch of empty hours. Tall enough to read its own label. */
const GAP_PX = 34;
/** Fold only a real run. Two empty hours are cheaper to scroll past than to
 *  read a sentence about. */
const MIN_COLLAPSE = 3;

type GridRow =
  | { kind: "hour"; i: number; top: number }
  | { kind: "gap"; from: number; count: number; top: number };

/**
 * The rows of the grid, with empty stretches folded away.
 *
 * Why (2026-09-19, the same afternoon the grid shipped): this floor's demos
 * cluster at both ends of a Singapore day — 2-4 AM is US business hours, and
 * 9-11 PM is the rest of it. So a week ran 1 AM to 11 PM and put seventeen
 * empty hours in the middle, about 1,100px of nothing to scroll past to reach
 * the evening. "I need to scroll down really long."
 *
 * A run of empty hours therefore folds into one band that **says how many
 * hours it stands for**, rather than being silently dropped: the distance
 * between two appointments is what this view is for, and a fold that lied
 * about it would be worse than the scrolling. An hour either side of every
 * booking is kept, so nothing is ever pressed against the edge of a fold, and
 * a booking can never run into one.
 */
function buildRows(
  count: number,
  isBusy: (i: number) => boolean,
): { rows: GridRow[]; slots: { top: number; folded: boolean }[]; height: number } {
  const keep = new Array<boolean>(count).fill(false);
  for (let i = 0; i < count; i++) {
    if (!isBusy(i)) continue;
    keep[Math.max(0, i - 1)] = true;
    keep[i] = true;
    keep[Math.min(count - 1, i + 1)] = true;
  }

  const rows: GridRow[] = [];
  const slots = new Array<{ top: number; folded: boolean }>(count);
  let top = 0;
  let i = 0;
  while (i < count) {
    if (keep[i]) {
      rows.push({ kind: "hour", i, top });
      slots[i] = { top, folded: false };
      top += HOUR_PX;
      i += 1;
      continue;
    }
    let j = i;
    while (j < count && !keep[j]) j += 1;
    const run = j - i;
    if (run >= MIN_COLLAPSE) {
      rows.push({ kind: "gap", from: i, count: run, top });
      for (let k = i; k < j; k++) slots[k] = { top, folded: true };
      top += GAP_PX;
    } else {
      for (let k = i; k < j; k++) {
        rows.push({ kind: "hour", i: k, top });
        slots[k] = { top, folded: false };
        top += HOUR_PX;
      }
    }
    i = j;
  }
  return { rows, slots, height: top };
}

/** Minutes from the top of the grid to a pixel offset, across the folds. */
function yFor(
  slots: { top: number; folded: boolean }[],
  minutes: number,
): number {
  const i = Math.max(0, Math.min(slots.length - 1, Math.floor(minutes / 60)));
  const slot = slots[i];
  if (!slot) return 0;
  // Nothing is ever placed inside a fold — an hour of padding either side sees
  // to that — so landing on one means a rounding edge, and its top is right.
  return slot.folded ? slot.top : slot.top + ((minutes - i * 60) / 60) * HOUR_PX;
}

/**
 * Which hours to draw.
 *
 * Not a fixed midnight-to-midnight: this floor rings the US from Singapore, so
 * the demos land at one in the morning as often as at two in the afternoon,
 * and a fixed 8-to-6 window would simply hide them. The range is taken from
 * the appointments themselves with an hour of air either side, which also
 * means no scrolling to find them — the alternative was Google's 24-hour
 * scroller, where a 9pm demo is below the fold on arrival.
 */
function hourWindow(placed: Placed[]): { from: number; to: number } {
  if (placed.length === 0) return { from: 8, to: 20 };
  let from = Math.floor(Math.min(...placed.map((p) => p.start)) / 60) - 1;
  let to = Math.ceil(Math.max(...placed.map((p) => p.end)) / 60) + 1;
  from = Math.max(0, from);
  to = Math.min(24, to);
  // A single 30-minute call would otherwise draw a three-hour calendar, which
  // reads as a fault rather than as a quiet day.
  while (to - from < 8) {
    if (from > 0) from -= 1;
    else if (to < 24) to += 1;
    else break;
  }
  return { from, to };
}

/** One appointment, wherever it is drawn. The kind is always said: a
 *  follow-up and the demo it follows are different appointments with the same
 *  business name on them, and the founders asked for them to be told apart. */
function Chip({
  m,
  tz,
  layout,
}: {
  m: Meeting;
  tz: string;
  layout: "month" | "grid";
}) {
  const off = m.status === "cancelled";
  const follow = m.kind === "follow_up";
  return (
    <span
      title={`${timeOf(m.startAt, tz, true)} · ${kindLabel(m)} · ${nameOf(m)}${off ? " · cancelled" : ""}`}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded px-1 py-0.5 leading-tight",
        layout === "month" ? "text-[11px]" : "h-full text-[11px]",
        off
          ? "bg-muted text-muted-foreground line-through"
          : follow
            ? // Green for the second conversation, clay for the first. The
              // colour is the glance; the word under it is the answer.
              m.startingSoon
              ? "bg-success text-primary-foreground font-semibold"
              : "bg-success/10 text-success font-medium"
            : m.startingSoon
              ? "bg-primary text-primary-foreground font-semibold"
              : "bg-primary/10 text-primary font-medium",
      )}
    >
      {/* Two lines, not one: at ~100px "10AM Tiger Fluids Pte. Ltd."
          truncated to "10AM TIGER F…", and the name is what people scan
          for, so it gets the width to itself.
          The kind rides on the time's line in ordinary case, not small caps
          with letter-spacing: a week column is about 90px, and "FOLLOW-UP"
          set that way truncated to "FOLL…" — which is exactly the thing this
          line was added to say. */}
      <span className="truncate text-[10px] font-semibold opacity-80">
        <span className="tabular-nums">{timeOf(m.startAt, tz)}</span>
        {" · "}
        {follow ? "Follow-up" : "Demo"}
      </span>
      {/* One line in the grid, two in a month cell. A grid block is sized by
          how long the booking runs, and a half-hour one is 32px — exactly two
          lines — so a name that wrapped would push itself out of its own
          block. A month cell is 86px and can afford the second line. The
          whole name is on the title either way. */}
      <span
        className={cn(
          layout === "month" ? "line-clamp-2 break-words" : "truncate",
        )}
      >
        {nameOf(m)}
      </span>
    </span>
  );
}

export function MeetingsCalendar({
  span,
  anchor,
  meetings,
  tz,
  zoneLabel,
  today,
  now,
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
  /** This instant, decided by the page beside `today` rather than read here.
   *  A component that calls `Date.now()` while rendering is impure — and the
   *  two must agree anyway, or the rolling window starts on a different day
   *  from the one the grid calls today. */
  now: string;
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

  const days = span === "next24" ? [] : datesFor(span, anchor);

  // The rolling window: from the top of the current hour, on the reader's own
  // clock, for the next twenty-four. Truncated to the hour rather than to the
  // minute so the grid lines up with the hour labels beside it; `minutesOf`
  // gives minutes past midnight *there*, which is what makes this right in a
  // zone offset by half an hour too.
  const nowMs = new Date(now).getTime();
  const rollStart =
    nowMs - (minutesOf(new Date(nowMs).toISOString(), tz) % 60) * 60_000 -
    (nowMs % 60_000);
  const rollEnd = rollStart + NEXT_HOURS * 3_600_000;
  const rolling =
    span === "next24"
      ? meetings.filter((m) => {
          const t = new Date(m.startAt).getTime();
          return t >= rollStart && t < rollEnd;
        })
      : [];

  const shown =
    span === "next24"
      ? rolling.length
      : days.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);

  // Every control keeps the view and the zone. The month arrows used to drop
  // `view=calendar`, so turning the page bounced the reader back to the list
  // they had just switched away from.
  const at = (s: CalendarSpan, on: string) =>
    `/meetings?view=calendar&span=${s}&on=${on}${query}`;
  const back = shift(span, anchor, -1);
  const forward = shift(span, anchor, 1);

  const SPANS: { id: CalendarSpan; label: string }[] = [
    // First, because it is the one that answers "what is coming" — the
    // question the other three each answer only within their own box.
    { id: "next24", label: "Next 24h" },
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];

  // One scale across every column, worked out once: seven days on seven
  // different hour ranges would put 9am at a different height in each and
  // make the whole point of the grid — comparing days — impossible.
  const placedByDay = new Map<string, Placed[]>();
  for (const d of days) placedByDay.set(d, place(byDay.get(d) ?? [], tz));
  const { from, to } =
    span === "month" || span === "next24"
      ? { from: 0, to: 0 }
      : hourWindow(days.flatMap((d) => placedByDay.get(d) ?? []));
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  // Which of those hours anything actually touches, so the empty stretches in
  // between can be folded. Measured across every day on screen: a fold has to
  // be the same height in all seven columns or the week stops lining up.
  const grid = buildRows(hours.length, (i) => {
    const lo = (from + i) * 60;
    const hi = lo + 60;
    return days.some((d) =>
      (placedByDay.get(d) ?? []).some((pl) => pl.start < hi && pl.end > lo),
    );
  });
  const bodyPx = grid.height;

  const header = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-2.5">
      <h2 className="text-[15px] font-bold tracking-[-0.01em]">
        {span === "next24" ? "Next 24 hours" : spanLabel(span, anchor)}
      </h2>
      <span className="text-[13px] text-muted-foreground">
        {shown === 0
          ? span === "next24"
            ? "Nothing in the next 24 hours"
            : `Nothing booked this ${span}`
          : `${shown} ${shown === 1 ? "demo" : "demos"} · times in ${zoneLabel}`}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {/* No Today and no arrows on the rolling window: it starts at this
            hour by definition, so there is nowhere to page to and nothing to
            come back from. A dead arrow that moved nothing would be worse
            than none. */}
        {span !== "next24" && (
        <>
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
        </>
        )}
        {/* All four drawn, like the List/Calendar pair: a single button
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
  );

  if (span === "month") {
    const lead = columnOf(days[0]);
    return (
      <div className="rounded-xl border bg-card">
        {header}
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
          {/* The blanks before the first: a grid with no lead-in puts the
              month on the wrong weekday, which is the one thing a calendar
              must never do. */}
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
                  {/* Dropped on a phone, where a cell is about 50px and the
                      word ran straight over the next day's number. */}
                  {date === today && (
                    <span className="hidden truncate font-bold uppercase tracking-[0.06em] sm:inline">
                      Today
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {rows.map((m) => (
                    <Chip key={m.id} m={m} tz={tz} layout="month" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (span === "next24") {
    // A rolling strip, not a day. The whole reason it exists: a day view ends
    // at midnight, so an 11pm demo and a 2am one three hours later sit on two
    // different pages — you read the first, see the day is done, and go to
    // bed. Here midnight is a line across the middle like any other hour, and
    // the gap between two appointments is the distance between them whichever
    // side of it they fall.
    const placedRoll = placeFrom(rolling, rollStart, NEXT_HOURS * 60);
    // Folded like the other grids, with one extra rule: the hour a new day
    // starts in is never folded away. That line is the entire point of this
    // view, and a date label floating inside a "nothing booked" band would
    // say neither thing clearly.
    const rollGrid = buildRows(NEXT_HOURS, (i) => {
      const lo = i * 60;
      const hi = lo + 60;
      if (
        i > 0 &&
        dayOf(new Date(rollStart + i * 3_600_000).toISOString(), tz) !==
          dayOf(new Date(rollStart + (i - 1) * 3_600_000).toISOString(), tz)
      ) {
        return true;
      }
      return placedRoll.some((pl) => pl.start < hi && pl.end > lo);
    });
    const marks = Array.from({ length: NEXT_HOURS }, (_, i) => {
      const at = new Date(rollStart + i * 3_600_000);
      return {
        i,
        label: new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "numeric",
        }).format(at),
        // The first hour of a new day names it, so "2 AM" cannot be read as
        // this morning's.
        dayBreak:
          i > 0 &&
          dayOf(at.toISOString(), tz) !==
            dayOf(new Date(rollStart + (i - 1) * 3_600_000).toISOString(), tz)
            ? fmt(dayOf(at.toISOString(), tz), {
                weekday: "short",
                day: "numeric",
                month: "short",
              })
            : null,
      };
    });

    return (
      <div className="rounded-xl border bg-card">
        {header}
        <div className="relative flex">
          {rollGrid.rows.map((r) =>
            r.kind === "gap" ? (
              <div
                key={`g${r.from}`}
                // Starts after the time column rather than spanning everything: at
              // `inset-x-0` the band lay over the gutter and cut the hour
              // label sitting on its bottom edge in half.
              className="absolute right-0 left-12 z-10 flex items-center justify-center border-y bg-muted/60 sm:left-14"
                style={{ top: r.top, height: GAP_PX }}
              >
                <span className="text-[11px] text-muted-foreground">
                  {r.count} hours, nothing booked
                </span>
              </div>
            ) : null,
          )}
          <div
            className={cn(GUTTER, "relative shrink-0")}
            style={{ height: rollGrid.height }}
          >
            {rollGrid.rows.map((r) =>
              r.kind === "hour" ? (
                <span
                  key={`h${r.i}`}
                  className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
                  style={{ top: r.top }}
                >
                  {r.i === 0 ? "" : marks[r.i].label}
                </span>
              ) : null,
            )}
          </div>
          <div
            className="relative min-w-0 flex-1 border-l"
            style={{ height: rollGrid.height }}
          >
            {rollGrid.rows.map((r) => r.kind === "hour" ? (
              <div key={`l${r.i}`} aria-hidden={!marks[r.i].dayBreak}>
                <div
                  className={cn(
                    "absolute inset-x-0 border-t",
                    // The day change is drawn heavier than an hour line, and
                    // named. It is the boundary this view was built to stop
                    // people falling off.
                    marks[r.i].dayBreak ? "border-primary/40" : "border-border/60",
                  )}
                  style={{ top: r.top }}
                />
                {marks[r.i].dayBreak && (
                  <span
                    className="absolute left-2 z-20 -translate-y-1/2 rounded bg-card px-1 text-[10px] font-bold uppercase tracking-[0.06em] text-primary"
                    style={{ top: r.top }}
                  >
                    {marks[r.i].dayBreak}
                  </span>
                )}
              </div>
            ) : null)}
            {placedRoll.map((pl) => (
              <div
                key={pl.m.id}
                className="absolute px-[2px]"
                style={{
                  top: yFor(rollGrid.slots, pl.start),
                  height: Math.max(
                    MIN_BLOCK_PX,
                    yFor(rollGrid.slots, pl.end) - yFor(rollGrid.slots, pl.start),
                  ),
                  left: `${(pl.col / pl.cols) * 100}%`,
                  width: `${(1 / pl.cols) * 100}%`,
                }}
              >
                <Chip m={pl.m} tz={tz} layout="grid" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Day and week: hours down the side, appointments sized by how long they
  // run, so the gap between two of them is a distance rather than arithmetic.
  return (
    <div className="rounded-xl border bg-card">
      {header}

      {/* A week is seven columns and a gutter, which at 390px leaves about
          44px each — "2AM · Follow-up" truncated to "2AM …" and the name
          wrapped to nothing readable. So the grid scrolls inside its own
          container below ~640px, the exception the layout rules already make
          for tables and diagrams. The day header and the body are inside the
          same scroller, or they would slide out of line with each other. A
          day view is one column and needs none of it. */}
      <div className={cn(span === "week" && "overflow-x-auto")}>
      <div className={cn(span === "week" && "min-w-[640px]")}>
      <div className="flex border-b bg-muted/40">
        <div className={cn(GUTTER, "shrink-0")} />
        {days.map((date) => (
          <div
            key={date}
            className={cn(
              "flex-1 border-l px-1 py-1.5 text-center",
              date === today && span === "week" && "bg-primary/5",
            )}
          >
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              {fmt(date, { weekday: span === "day" ? "long" : "short" })}
            </div>
            <div
              className={cn(
                "text-[13px] font-bold tabular-nums",
                date === today ? "text-primary" : "text-foreground",
              )}
            >
              {Number(date.slice(8))}
            </div>
          </div>
        ))}
      </div>

      <div className="relative flex">
        {/* One band across the whole grid rather than one per column: seven
            copies of "17 hours, nothing booked" would be noise, and the thing
            it describes is the same in every column. Drawn over the columns,
            which is safe because a fold never contains an appointment. */}
        {grid.rows.map((r) =>
          r.kind === "gap" ? (
            <div
              key={`g${r.from}`}
              // Starts after the time column rather than spanning everything: at
              // `inset-x-0` the band lay over the gutter and cut the hour
              // label sitting on its bottom edge in half.
              className="absolute right-0 left-12 z-10 flex items-center justify-center border-y bg-muted/60 sm:left-14"
              style={{ top: r.top, height: GAP_PX }}
            >
              <span className="text-[11px] text-muted-foreground">
                {r.count} hours, nothing booked
              </span>
            </div>
          ) : null,
        )}
        {/* The hour labels. Each sits on its line rather than inside its row,
            which is where the eye looks for it — the line is the boundary the
            appointment starts at. */}
        <div className={cn(GUTTER, "relative shrink-0")} style={{ height: bodyPx }}>
          {grid.rows.map((r) =>
            r.kind === "hour" ? (
              <span
                key={`h${r.i}`}
                className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
                style={{ top: r.top }}
              >
                {/* The first label would be clipped by the top edge, and the
                    header above already names the day. */}
                {r.i === 0 ? "" : hourLabel(hours[r.i])}
              </span>
            ) : null,
          )}
        </div>

        {days.map((date) => {
          const placed = placedByDay.get(date) ?? [];
          return (
            <div
              key={date}
              className={cn(
                "relative min-w-0 flex-1 border-l",
                // Only on a week. A day view is one column and tinting all of
                // it names nothing — it just washes the grid pink.
                date === today && span === "week" && "bg-primary/5",
              )}
              style={{ height: bodyPx }}
            >
              {grid.rows.map((r) =>
                r.kind === "hour" ? (
                  <div
                    key={`l${r.i}`}
                    aria-hidden
                    className="absolute inset-x-0 border-t border-border/60"
                    style={{ top: r.top }}
                  />
                ) : null,
              )}
              {placed.map((p) => {
                const top = yFor(grid.slots, p.start - from * 60);
                const height = Math.max(
                  MIN_BLOCK_PX,
                  yFor(grid.slots, p.end - from * 60) - top,
                );
                return (
                  <div
                    key={p.m.id}
                    className="absolute px-[2px]"
                    style={{
                      top,
                      height,
                      left: `${(p.col / p.cols) * 100}%`,
                      width: `${(1 / p.cols) * 100}%`,
                    }}
                  >
                    <Chip m={p.m} tz={tz} layout="grid" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}
