import { cache } from "react";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { CallOutcome } from "@/lib/calls";
// The zone join and the 9-to-5 rule come from `calls.ts` rather than being
// restated: the dialler filters the queue by that rule, and a report saying a
// call was out of hours had better agree with the screen that handed it over.
import {
  LEAD_HOURS_END,
  LEAD_HOURS_START,
  leadZone,
  withinLeadHours,
} from "@/lib/calls";
import { STATS_TZ } from "@/lib/stats-zones";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/**
 * Outcomes that mean a person was on the other end.
 *
 * `bad_number` is deliberately not one of them: the line was wrong, nobody was
 * spoken to, and counting it as a pickup would flatter the pickup rate exactly
 * where the data is worst. Voicemail and no answer are not pickups either;
 * gatekeeper is — a receptionist is a person, and getting past one is the job.
 *
 * Exported for Payroll, which pays a bonus per 50 of them. Two definitions of
 * a pickup would be two different numbers on two screens, and the one people
 * are paid on had better be the one they can see on Stats.
 */
export const PICKUP = sql`('gatekeeper','callback','not_interested','demo_booked','trial','won','lost')`;

export type CallTotals = {
  /** Calls logged in the range — attempts, not leads. */
  calls: number;
  /** Distinct leads those calls were to. */
  leadsDialled: number;
  pickups: number;
  demos: number;
  trials: number;
  won: number;
  lost: number;
  /** Leads whose number turned out to be wrong. */
  badNumbers: number;
  /** Calls placed outside 9 to 5 where the person answering was. Counted only
   *  over the calls whose zone is known, so it is a fraction of `zoneKnown`
   *  and not of `calls`. */
  outsideHours: number;
  /** Calls whose number maps to a zone at all: the honest denominator for the
   *  figure above. Toll-free numbers and area codes with no row belong to no
   *  place, and calling those out of hours would be a guess. */
  zoneKnown: number;
};

/**
 * Monday (Eastern) of the week a date falls in, as YYYY-MM-DD.
 *
 * Payroll stamps it onto the payout row so history groups by week in the
 * database rather than being re-derived on every read: the reporting zone has
 * moved once already, from Singapore to New York, and that must not silently
 * reshuffle which week an old payment belongs to. The quota bar uses the same
 * Monday, so a caller's week of work and their week of pay are the same seven
 * days.
 *
 * Built by string arithmetic through an explicit `Z`, the same pattern
 * `dayBackInStatsTz` uses: a calendar date has no zone, and
 * `new Date("2026-08-27")` is UTC midnight, which reads as the day before
 * anywhere west of Greenwich.
 *
 * Here rather than in `payroll.ts`, which already imports from this module and
 * would otherwise close a cycle.
 */
export function payWeekStart(today = todayInStatsTz()): string {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

export type WeekProgress = {
  /** Calls this person has logged since Monday. */
  calls: number;
  /** The Monday it is counting from, YYYY-MM-DD, for the label. */
  weekStart: string;
};

/**
 * One caller's week so far, for the progress bar in the app shell.
 *
 * Counted by `getCallTotals` rather than by a query of its own, so "a call"
 * means exactly what it means on Stats and the Scoreboard. A bar in the header
 * disagreeing with the screen it sits above would be worse than no bar.
 *
 * `cache()`d because the shell renders it on every page, the same reason
 * `countUnreadReplies` and `countCallbacksDue` are.
 *
 * The week is Payroll's week: Monday, cut in `STATS_TZ`, whatever zone the
 * reader has picked for their reporting screens. A quota week that moved with
 * the timezone picker would let someone change how much work they owe by
 * changing a dropdown.
 */
export const getWeekProgress = cache(
  async (userId: number): Promise<WeekProgress> => {
    const weekStart = payWeekStart();
    const totals = await getCallTotals(
      {
        kind: "between",
        from: weekStart,
        to: todayInStatsTz(STATS_TZ),
        tz: STATS_TZ,
      },
      undefined,
      userId,
    );
    return { calls: totals.calls, weekStart };
  },
);

export type OutcomeCount = { outcome: CallOutcome; calls: number };

export type ListStat = {
  id: number;
  name: string;
  /** Every lead on the list, duplicates excluded — the denominator for worked. */
  leads: number;
  /** Leads with at least one call ever, regardless of range. */
  worked: number;
  /** Calls in the range. */
  calls: number;
  pickups: number;
  demos: number;
  trials: number;
  won: number;
};

/**
 * The zones live in `lib/stats-zones.ts` and are re-exported here.
 *
 * They are a lookup table and three string helpers with no database in them,
 * and the timezone picker is a client component: importing them from this
 * module pulls the Postgres client into the browser bundle, the same wall
 * `components/calls/outcome.ts` was built to get around. Re-exported rather
 * than moved outright so every existing `from "@/lib/call-stats"` keeps
 * working — Payroll's `STATS_TZ` among them.
 *
 * `STATS_TZ` is named apart from the `CALL_TZ` in `lib/calls.ts` on purpose —
 * that one still says Singapore and counts "called today" on the dialler and
 * the call lists. Two constants because they answer different questions, and a
 * single one would have moved the callback diary too, which is booked and read
 * in Singapore time via `parseCallbackAt`.
 */
export {
  STATS_TZ,
  STATS_ZONES,
  DEFAULT_STATS_REGION,
  isStatsRegion,
  statsZone,
} from "@/lib/stats-zones";
export type { StatsRegion } from "@/lib/stats-zones";

/**
 * What slice of time the numbers cover.
 *
 * `rolling` is the last N days up to this moment; `day` is one calendar day in
 * Eastern time, which is what "how did we do today" means and what a rolling
 * 24-hour window does not.
 */
export type StatsWindow = (
  | { kind: "all" }
  | { kind: "rolling"; days: number }
  | { kind: "day"; date: string }
  /** Two calendar dates in the reporting zone, inclusive of both ends — the
   *  range someone types when they want a competition week or a named month
   *  rather than the last N days counted backwards from this moment. Dates are
   *  carried as YYYY-MM-DD strings the whole way and never turned into a
   *  `Date`: parsing one gives UTC midnight, which reads as the previous day
   *  in every zone west of it. */
  | { kind: "between"; from: string; to: string }
) & {
  /**
   * The zone a "day" in this window is measured in. Absent means Eastern.
   *
   * Carried on the window rather than passed alongside it to every query,
   * because it is part of what the window *means*: "27 August" is a different
   * eight hours in Singapore than in New York, and a window that travelled
   * without its zone would be read in whichever one each function assumed.
   * Every existing call site keeps working — absent is the old constant.
   */
  tz?: string;
};

/** A YYYY-MM-DD calendar date, and nothing else. Guards the query — these
 *  reach Postgres as `::date`, where a malformed string is an error rather
 *  than an empty result. */
export const isStatsDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Today in the reporting zone, as YYYY-MM-DD — the default for a day picker's
 *  max, and what "today" resolves to. */
export const todayInStatsTz = (tz: string = STATS_TZ) =>
  new Date().toLocaleDateString("en-CA", { timeZone: tz });

/**
 * The calendar date N days before today in the reporting zone.
 *
 * Stepped in UTC on purpose. A calendar date carries no zone, so the arithmetic
 * must not go near a local `Date`: `new Date("2026-09-01")` is UTC midnight and
 * reads as 31 August anywhere west of Greenwich, which is the mismatch
 * `formatStatsDate` avoids by never building a Date at all. Landing on today in
 * the right zone is `todayInStatsTz`'s job; from there it is plain day
 * counting, and daylight saving cannot move a date by a whole day.
 */
export function dayBackInStatsTz(n: number, tz: string = STATS_TZ): string {
  const d = new Date(`${todayInStatsTz(tz)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const since = (w: StatsWindow): SQL => {
  // Eastern unless the window says otherwise, which is what every window said
  // before the zone picker existed.
  const tz = w.tz ?? STATS_TZ;
  if (w.kind === "all") return sql`true`;
  if (w.kind === "day") {
    return sql`(c.called_at at time zone ${tz})::date = ${w.date}::date`;
  }
  if (w.kind === "between") {
    // Both ends inclusive: someone picking 1st to 31st means the whole month,
    // and a range that quietly dropped its last day would under-report the
    // final shift of every competition.
    return sql`(c.called_at at time zone ${tz})::date
      between ${w.from}::date and ${w.to}::date`;
  }
  // A rolling window is a clock, not a set of dates: N days back from this
  // moment is the same instant everywhere, so it has no zone to read.
  return sql`c.called_at >= now() - ${`${w.days} days`}::interval`;
};

/** Narrow to one niche. Joining through the lead is the only route — `call`
 *  has no list of its own, by design. */
/** Narrow to one person's calls. `call.user_id` is null for anything logged
 *  before staff accounts existed, so those fall out of a person filter, which
 *  is right: they belong to nobody. */
const byUser = (userId?: number): SQL =>
  userId ? sql`and c.user_id = ${userId}` : sql``;

const inList = (listId?: number): SQL =>
  listId
    ? sql`and exists (
        select 1 from call_lead l
        where l.id = c.call_lead_id and l.call_list_id = ${listId}
      )`
    : sql``;

export async function getCallTotals(
  w: StatsWindow,
  listId?: number,
  userId?: number,
): Promise<CallTotals> {
  const [row] = (await db.execute(sql`
    select
      count(*) as calls,
      count(distinct c.call_lead_id) as leads_dialled,
      count(*) filter (where c.outcome in ${PICKUP}) as pickups,
      -- Distinct leads for the outcomes that are a result rather than an
      -- event: logging "demo booked" twice for one business is one demo, and
      -- counting the calls would say two.
      count(distinct c.call_lead_id) filter (where c.outcome = 'demo_booked') as demos,
      count(distinct c.call_lead_id) filter (where c.outcome = 'trial') as trials,
      count(distinct c.call_lead_id) filter (where c.outcome = 'won') as won,
      count(distinct c.call_lead_id) filter (where c.outcome = 'lost') as lost,
      count(distinct c.call_lead_id) filter (where c.outcome = 'bad_number') as bad_numbers,
      -- Attempts, not leads: ringing one business three times at midnight is
      -- three calls made out of hours, and counting it once would read as a
      -- single slip rather than a habit.
      count(*) filter (where z.tz is not null and not ${withinLeadHours(sql`c.called_at`)}) as outside_hours,
      count(*) filter (where z.tz is not null) as zone_known
    from call c
    -- Joined for the zone alone. call_lead_id is not null and the lateral
    -- always yields exactly one row, so no count above can move.
    join call_lead l on l.id = c.call_lead_id
    ${leadZone}
    where ${since(w)} ${inList(listId)} ${byUser(userId)}
  `)) as Row[];

  return {
    calls: n(row?.calls),
    leadsDialled: n(row?.leads_dialled),
    pickups: n(row?.pickups),
    demos: n(row?.demos),
    trials: n(row?.trials),
    won: n(row?.won),
    lost: n(row?.lost),
    badNumbers: n(row?.bad_numbers),
    outsideHours: n(row?.outside_hours),
    zoneKnown: n(row?.zone_known),
  };
}

export async function getOutcomeCounts(
  w: StatsWindow,
  listId?: number,
  userId?: number,
): Promise<OutcomeCount[]> {
  const rows = (await db.execute(sql`
    select c.outcome, count(*) as calls
    from call c
    where ${since(w)} ${inList(listId)} ${byUser(userId)}
    group by c.outcome
    order by count(*) desc
  `)) as Row[];

  return rows.map((r) => ({
    outcome: r.outcome as CallOutcome,
    calls: n(r.calls),
  }));
}

/**
 * Per-list performance.
 *
 * `leads` and `worked` are lifetime figures and `calls` onwards are inside the
 * range, because "how much of this list is left" is not a question about the
 * last seven days. The column headings say so.
 */
export async function getListStats(
  w: StatsWindow,
  listId?: number,
  userId?: number,
): Promise<ListStat[]> {
  // Every call-level number is scoped to the person, including "worked":
  // filtered to one caller, that column has to mean leads *they* have rung,
  // not leads anyone has. `leads` stays the size of the list, which is a
  // property of the list rather than of anybody's day.
  const mine = userId ? sql`and c.user_id = ${userId}` : sql``;
  const mineEver = userId ? sql`and x.user_id = ${userId}` : sql``;
  const rows = (await db.execute(sql`
    select cl.id, cl.name,
      count(distinct l.id) as leads,
      count(distinct l.id) filter (where ever.called) as worked,
      count(c.id) filter (where ${since(w)} ${mine}) as calls,
      count(c.id) filter (where ${since(w)} ${mine} and c.outcome in ${PICKUP}) as pickups,
      count(distinct c.call_lead_id) filter (
        where ${since(w)} ${mine} and c.outcome = 'demo_booked'
      ) as demos,
      count(distinct c.call_lead_id) filter (
        where ${since(w)} ${mine} and c.outcome = 'trial'
      ) as trials,
      count(distinct c.call_lead_id) filter (
        where ${since(w)} ${mine} and c.outcome = 'won'
      ) as won
    from call_list cl
    left join call_lead l
      on l.call_list_id = cl.id and l.duplicate_of_lead_id is null
    left join lateral (
      select true as called
      from call x where x.call_lead_id = l.id ${mineEver} limit 1
    ) ever on true
    left join call c on c.call_lead_id = l.id
    where ${listId ? sql`cl.id = ${listId}` : sql`true`}
    group by cl.id, cl.name
    order by cl.created_at desc, cl.id desc
  `)) as Row[];

  return rows.map((r) => ({
    id: n(r.id),
    name: String(r.name),
    leads: n(r.leads),
    worked: n(r.worked),
    calls: n(r.calls),
    pickups: n(r.pickups),
    demos: n(r.demos),
    trials: n(r.trials),
    won: n(r.won),
  }));
}

export type PersonStat = {
  /** Null for the calls made before staff logins existed. */
  id: number | null;
  name: string;
  calls: number;
  pickups: number;
  demos: number;
  trials: number;
  won: number;
};

/**
 * Who did what, in the range.
 *
 * A LEFT JOIN rather than an inner one, and grouped on the id so the
 * pre-accounts calls come back as a single "Not attributed" row instead of
 * disappearing — 136 calls quietly missing from a per-person breakdown that
 * still totalled correctly elsewhere would read as a bug in the stats.
 *
 * Demos, trials and won count distinct leads for the same reason the tiles
 * do: logging "demo booked" twice for one business is one demo.
 */
export async function getPersonStats(
  w: StatsWindow,
  listId?: number,
  userId?: number,
): Promise<PersonStat[]> {
  const rows = (await db.execute(sql`
    select u.id, u.name,
      count(*) as calls,
      count(*) filter (where c.outcome in ${PICKUP}) as pickups,
      count(distinct c.call_lead_id) filter (where c.outcome = 'demo_booked') as demos,
      count(distinct c.call_lead_id) filter (where c.outcome = 'trial') as trials,
      count(distinct c.call_lead_id) filter (where c.outcome = 'won') as won
    from call c
    left join app_user u on u.id = c.user_id
    where ${since(w)} ${inList(listId)} ${byUser(userId)}
    group by u.id, u.name
    order by count(*) desc, u.name asc
  `)) as Row[];

  return rows.map((r) => ({
    id: r.id === null ? null : n(r.id),
    name: (r.name as string | null) ?? "Not attributed",
    calls: n(r.calls),
    pickups: n(r.pickups),
    demos: n(r.demos),
    trials: n(r.trials),
    won: n(r.won),
  }));
}

export type DayStat = { day: string; calls: number; pickups: number };

/** A YYYY-MM month, and nothing else. Guards the query the way `isStatsDate`
 *  does — the value is concatenated into a `::date` below. */
export const isStatsMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** The month we are in, in the reporting zone — the calendar's default. */
export const monthInStatsTz = (tz: string = STATS_TZ) =>
  todayInStatsTz(tz).slice(0, 7);

/** The month a window sits in, which is the one worth opening the calendar on:
 *  a day or a date range names its own, and a rolling window or all-time is
 *  read from where the work is now. `between` follows its later end, that
 *  being the end someone is usually looking at. */
export function monthOf(w: StatsWindow): string {
  if (w.kind === "day") return w.date.slice(0, 7);
  if (w.kind === "between") return w.to.slice(0, 7);
  return monthInStatsTz(w.tz);
}

/**
 * Calls per day for one calendar month, in Eastern.
 *
 * A month rather than the fortnight this used to return: the fortnight was
 * always the last fourteen days whatever the range above it said, so a screen
 * filtered to a day in June answered with a chart of the days around today.
 * A month is a shape people already navigate — the picker pages through them —
 * and it is what the range in force can be shown *inside*.
 *
 * Days with no calls are filled in rather than skipped — a gap in a run of
 * dates reads as a quiet day, whereas a missing row silently closes it up and
 * makes the week look busier than it was. In a calendar it is also the grid:
 * a missing day would shift every one after it into the wrong column.
 */
export async function getCallsByMonth(
  month: string,
  listId?: number,
  userId?: number,
  /** The zone the days are cut in — the same one the window uses, or the
   *  grid says one thing and the tiles above it another. */
  tz: string = STATS_TZ,
): Promise<DayStat[]> {
  const first = `${month}-01`;
  const rows = (await db.execute(sql`
    select d::date as day,
      count(c.id) as calls,
      count(c.id) filter (where c.outcome in ${PICKUP}) as pickups
    from generate_series(
      -- Both ends cast: an untyped parameter here resolves as text, and
      -- generate_series has no overload for it. The end is the last day of
      -- the month, worked out by Postgres rather than by counting 28s.
      ${first}::date,
      (${first}::date + interval '1 month' - interval '1 day')::date,
      '1 day'
    ) d
    -- The niche clause belongs in the join, not a WHERE: filtering after the
    -- LEFT JOIN would drop the empty days this series exists to keep.
    left join call c
      on (c.called_at at time zone ${tz})::date = d::date
      and (${listId ?? null}::int is null or exists (
        select 1 from call_lead l
        where l.id = c.call_lead_id and l.call_list_id = ${listId ?? null}
      ))
      and (${userId ?? null}::int is null or c.user_id = ${userId ?? null})
    group by d
    order by d asc
  `)) as Row[];

  return rows.map((r) => ({
    // Already an Eastern calendar date; formatting it through a Date would
    // shift it back into UTC and undo the point of the query.
    day: String(r.day).slice(0, 10),
    calls: n(r.calls),
    pickups: n(r.pickups),
  }));
}

export type CallLogRow = {
  id: number;
  /** Which table the row came from. Ids are only unique within one, so this is
   *  half of any key — and it is what the table renders differently. */
  source: "call" | "keypad";
  calledAt: string;
  /** Null for a keypad call: there is no lead for it to be an outcome about. */
  outcome: CallOutcome | null;
  by: string;
  company: string;
  phone: string;
  /** Null for a keypad call, which belongs to no niche. */
  listName: string | null;
  notes: string | null;
  callbackAt: string | null;
  /** Keypad only: this leg was added to a call already up. */
  addedToCall: boolean;
  /** The wall clock where the prospect was, at the moment they were rung, as
   *  "HH:MM". Null when the number maps to no zone (toll-free, an area code
   *  not in `us_area_code`) and on every keypad row, which has no lead. */
  theirTime: string | null;
  /** Whether that was inside 9 to 5 their time. Null where the zone is
   *  unknown: that is "we cannot say", which is a different answer from "they
   *  were rung at four in the morning" and must not be flagged as one. */
  inHours: boolean | null;
  /** Telnyx's file for this call, when it was dialled from the browser and the
   *  webhook has landed. Null for every handset call, every no-answer, and
   *  everything logged before browser dialling existed — which is most rows. */
  recordingId: string | null;
  recordingMs: number | null;
};

/** Enough to read a day or a week without turning the page into a database
 *  dump. The screen says when it bites rather than quietly showing part of a
 *  range, the same way the spreadsheet does. */
export const CALL_LOG_LIMIT = 300;

/**
 * What the log can be narrowed to: one outcome, or the keypad.
 *
 * "keypad" is not an outcome and never becomes one — it says which table the
 * row came from. It sits in the same control because that is the question
 * being asked of this table ("show me only the…"), and because a keypad call
 * having no outcome is precisely why it needs its own entry rather than
 * hiding under one.
 */
export type LogFilterValue = CallOutcome | "keypad";

/** The recording for a call session, newest first within it. One session can
 *  produce more than one file, and both `call` and `keypad_call` reach them
 *  the same way — the webhook stores recordings against the session id with no
 *  idea which of the two placed the call. */
const recordingFor = sql`
  left join lateral (
    select rr.recording_id, rr.duration_ms
    from call_recording rr
    where rr.call_session_id = c.telnyx_session_id
    order by rr.started_at desc nulls last, rr.id desc
    limit 1
  ) r on true
`;

/**
 * Every individual call, newest first — keypad dials included.
 *
 * The tables above answer "how many"; this one answers "which ones". Filtering
 * to one person turns it into that person's shift, which is the thing you
 * actually read when a number looks wrong.
 *
 * This is the **only** query in the app that reads `keypad_call`, and the
 * union is deliberately confined to it: a keypad dial has no lead and no
 * outcome, so it cannot be a pickup, cannot belong to a niche, and must not
 * move a tile, a chart, the Scoreboard or a payout. It is here because "who
 * rang that number, and can I hear it" is a question about the record rather
 * than about the numbers.
 *
 * Two consequences fall straight out of that and are intended: filtering by
 * niche drops keypad rows entirely, because they are in no niche; and
 * filtering by outcome drops them too, except for the "keypad" value that asks
 * for exactly those.
 *
 * The niche filter is written against `call_list` directly rather than through
 * the shared `inList` helper: that one aliases `call_lead` as `l` inside a
 * subquery, and this query already has an `l` of its own. `keypad_call` is
 * aliased `c` for the opposite reason — `since` and `byUser` are written
 * against that alias, and reusing it is what lets one window and one person
 * filter serve both halves.
 */
export async function getCallLog(
  w: StatsWindow,
  listId?: number,
  userId?: number,
  filter?: LogFilterValue,
): Promise<CallLogRow[]> {
  const wantCalls = filter !== "keypad";
  // A niche filter is a filter on something keypad rows do not have. Excluding
  // them is not a technicality: leaving them in would put calls that belong to
  // no list under a heading naming one.
  const wantKeypad = !listId && (filter === undefined || filter === "keypad");
  // Keypad calls, narrowed to a niche they cannot be in. Neither half has
  // anything to contribute, and there is no query to run — the screen says why
  // rather than showing an empty table under a filter that reads as broken.
  if (!wantCalls && !wantKeypad) return [];

  // `c.outcome` is the `call_outcome` enum and the keypad half has no outcome
  // at all, so it is cast to text on both sides — Postgres will not union an
  // enum with a null literal, and the mapping back is one cast either way.
  const calls = sql`
    select 'call' as source, c.id, c.called_at, c.outcome::text as outcome,
      c.notes, c.callback_at, false as added_to_call,
      u.name as by_name,
      coalesce(nullif(l.company, ''), nullif(l.name, ''), l.phone) as company,
      -- No cl.region here since 2026-08-29: every row in this table is now
      -- rendered in the zone the screen is set to, so a per-niche market has
      -- nothing left to decide.
      l.phone, cl.name as list_name,
      -- The clock the person who answered was reading. Formatted here rather
      -- than shipped as a zone and formatted in the browser: the zone varies
      -- per row, and a time built client-side renders one string on the server
      -- and another on hydration. Null where the area code maps to no zone.
      to_char(c.called_at at time zone z.tz, 'HH24:MI') as their_time,
      ${withinLeadHours(sql`c.called_at`)} as in_hours,
      z.tz is not null as zone_known,
      r.recording_id, r.duration_ms as recording_ms
    from call c
    join call_lead l on l.id = c.call_lead_id
    join call_list cl on cl.id = l.call_list_id
    ${leadZone}
    left join app_user u on u.id = c.user_id
    -- Per call, not per lead. The board can only ever reach the recording of a
    -- lead's *latest* call, because that is the row it hangs off; this table
    -- has a row per dial, so a business rung three times offers all three.
    ${recordingFor}
    where ${since(w)}
      ${listId ? sql`and cl.id = ${listId}` : sql``}
      ${byUser(userId)}
      ${filter && filter !== "keypad" ? sql`and c.outcome = ${filter}` : sql``}
  `;

  const keypad = sql`
    select 'keypad' as source, c.id, c.called_at, null::text as outcome,
      null::text as notes, null::timestamptz as callback_at, c.added_to_call,
      u.name as by_name,
      -- The saved line's name when there was one, and the number otherwise:
      -- the business column has to say something, and "pxn junk removal" says
      -- more than eleven digits repeated from the line below it.
      coalesce(nullif(c.label, ''), c.phone) as company,
      c.phone, null::text as list_name,
      -- No lead, so no niche and no zone to read the far end's clock in. A
      -- keypad dial is a test of a line rather than a call on a prospect, so
      -- there is no one whose business hours it could have been outside.
      null::text as their_time, null::boolean as in_hours,
      false as zone_known,
      r.recording_id, r.duration_ms as recording_ms
    from keypad_call c
    join app_user u on u.id = c.user_id
    ${recordingFor}
    where ${since(w)} ${byUser(userId)}
  `;

  // The limit belongs to the combined set, not to each half: 300 of each would
  // be 600 rows on a screen whose header promises 300.
  const body =
    wantCalls && wantKeypad
      ? sql`${calls} union all ${keypad}`
      : wantCalls
        ? calls
        : keypad;

  const rows = (await db.execute(sql`
    select * from (${body}) t
    order by called_at desc, source, id desc
    limit ${CALL_LOG_LIMIT}
  `)) as Row[];

  return rows.map((r) => {
    const source = r.source === "keypad" ? "keypad" : "call";
    return {
      id: n(r.id),
      source: source as "call" | "keypad",
      calledAt: String(r.called_at),
      outcome: r.outcome === null ? null : (r.outcome as CallOutcome),
      // Null for anything logged before staff accounts existed. Never for a
      // keypad row — that table's user is not nullable.
      by: (r.by_name as string | null) ?? "Not attributed",
      company: String(r.company),
      phone: String(r.phone),
      listName: r.list_name === null ? null : String(r.list_name),
      notes: (r.notes as string | null) ?? null,
      callbackAt: r.callback_at === null ? null : String(r.callback_at),
      addedToCall: r.added_to_call === true,
      theirTime: (r.their_time as string | null) ?? null,
      // Only a known zone gives a real answer. `zone_known` is what separates
      // "not in hours" from "no idea", which the flag has to keep apart.
      inHours: r.zone_known === true ? r.in_hours === true : null,
      recordingId: (r.recording_id as string | null) ?? null,
      recordingMs: r.recording_ms === null ? null : n(r.recording_ms),
    };
  });
}
