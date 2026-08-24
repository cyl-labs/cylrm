import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { CallOutcome } from "@/lib/calls";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/**
 * Outcomes that mean a person was on the other end.
 *
 * `bad_number` is deliberately not one of them: the line was wrong, nobody was
 * spoken to, and counting it as a pickup would flatter the pickup rate exactly
 * where the data is worst. Voicemail and no answer are not pickups either;
 * gatekeeper is — a receptionist is a person, and getting past one is the job.
 */
const PICKUP = sql`('gatekeeper','callback','not_interested','demo_booked','trial','won','lost')`;

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
};

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
 * The zone a reporting "day" is measured in: Eastern.
 *
 * Bucketing by UTC put a 7am call on the previous day's bar, so this was
 * always a real zone rather than the server's. It was Singapore until
 * 2026-08-25 and is now Eastern, because that is where the floor's work is:
 * every active caller bar the founders works US niches, and a shift that runs
 * to 6pm New York was landing on two different Singapore days.
 *
 * Named apart from the `CALL_TZ` in `lib/calls.ts` on purpose — that one still
 * says Singapore and counts "called today" on the dialler and the call lists.
 * Two constants because they answer different questions, and a single one
 * would have moved the callback diary too, which is booked and read in
 * Singapore time via `parseCallbackAt`.
 *
 * Unlike Singapore's fixed +08:00, Eastern has daylight saving, so there is
 * deliberately no offset constant to pair with this: every use goes through
 * Postgres `at time zone` or `Intl`, both of which read the zone database.
 */
const STATS_TZ = "America/New_York";

/**
 * What slice of time the numbers cover.
 *
 * `rolling` is the last N days up to this moment; `day` is one calendar day in
 * Eastern time, which is what "how did we do today" means and what a rolling
 * 24-hour window does not.
 */
export type StatsWindow =
  | { kind: "all" }
  | { kind: "rolling"; days: number }
  | { kind: "day"; date: string };

/** Today in Eastern, as YYYY-MM-DD — the default for a day picker's max. */
export const todayInStatsTz = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: STATS_TZ });

const since = (w: StatsWindow): SQL => {
  if (w.kind === "all") return sql`true`;
  if (w.kind === "day") {
    return sql`(c.called_at at time zone ${STATS_TZ})::date = ${w.date}::date`;
  }
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
      count(distinct c.call_lead_id) filter (where c.outcome = 'bad_number') as bad_numbers
    from call c
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

/**
 * Calls per day, most recent last.
 *
 * Days with no calls are filled in rather than skipped — a gap in a run of
 * dates reads as a quiet day, whereas a missing row silently closes it up and
 * makes the week look busier than it was.
 */
export async function getCallsByDay(
  days: number,
  listId?: number,
  userId?: number,
): Promise<DayStat[]> {
  const rows = (await db.execute(sql`
    select d::date as day,
      count(c.id) as calls,
      count(c.id) filter (where c.outcome in ${PICKUP}) as pickups
    from generate_series(
      -- The cast is load-bearing: an untyped parameter here resolves as a
      -- date, and date minus date is an integer, so generate_series was
      -- handed an int where it wanted a date.
      (now() at time zone ${STATS_TZ})::date - ${days - 1}::int,
      (now() at time zone ${STATS_TZ})::date,
      '1 day'
    ) d
    -- The niche clause belongs in the join, not a WHERE: filtering after the
    -- LEFT JOIN would drop the empty days this series exists to keep.
    left join call c
      on (c.called_at at time zone ${STATS_TZ})::date = d::date
      and (${listId ?? null}::int is null or exists (
        select 1 from call_lead l
        where l.id = c.call_lead_id and l.call_list_id = ${listId ?? null}
      ))
      and (${userId ?? null}::int is null or c.user_id = ${userId ?? null})
    group by d
    order by d asc
  `)) as Row[];

  return rows.map((r) => ({
    // Already a Singapore calendar date; formatting it through a Date would
    // shift it back into UTC and undo the point of the query.
    day: String(r.day).slice(0, 10),
    calls: n(r.calls),
    pickups: n(r.pickups),
  }));
}

export type CallLogRow = {
  id: number;
  calledAt: string;
  outcome: CallOutcome;
  by: string;
  company: string;
  phone: string;
  listName: string;
  /** The niche's market, which decides the zone its times are shown in. */
  region: "sg" | "us" | "gb" | null;
  notes: string | null;
  callbackAt: string | null;
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
 * Every individual call, newest first.
 *
 * The tables above answer "how many"; this one answers "which ones". Filtering
 * to one person turns it into that person's shift, which is the thing you
 * actually read when a number looks wrong.
 *
 * The niche filter is written against `call_list` directly rather than through
 * the shared `inList` helper: that one aliases `call_lead` as `l` inside a
 * subquery, and this query already has an `l` of its own.
 */
export async function getCallLog(
  w: StatsWindow,
  listId?: number,
  userId?: number,
  outcome?: CallOutcome,
): Promise<CallLogRow[]> {
  const rows = (await db.execute(sql`
    select c.id, c.called_at, c.outcome, c.notes, c.callback_at,
      u.name as by_name,
      coalesce(nullif(l.company, ''), nullif(l.name, ''), l.phone) as company,
      l.phone, cl.name as list_name, cl.region,
      r.recording_id, r.duration_ms as recording_ms
    from call c
    join call_lead l on l.id = c.call_lead_id
    join call_list cl on cl.id = l.call_list_id
    left join app_user u on u.id = c.user_id
    -- Per call, not per lead. The board can only ever reach the recording of a
    -- lead's *latest* call, because that is the row it hangs off; this table
    -- has a row per dial, so a business rung three times offers all three.
    -- Latest file first within a session: one session can produce more than
    -- one, the same lateral the board's query uses.
    left join lateral (
      select rr.recording_id, rr.duration_ms
      from call_recording rr
      where rr.call_session_id = c.telnyx_session_id
      order by rr.started_at desc nulls last, rr.id desc
      limit 1
    ) r on true
    where ${since(w)}
      ${listId ? sql`and cl.id = ${listId}` : sql``}
      ${byUser(userId)}
      ${outcome ? sql`and c.outcome = ${outcome}` : sql``}
    order by c.called_at desc, c.id desc
    limit ${CALL_LOG_LIMIT}
  `)) as Row[];

  return rows.map((r) => ({
    id: n(r.id),
    calledAt: String(r.called_at),
    outcome: r.outcome as CallOutcome,
    // Null for anything logged before staff accounts existed.
    by: (r.by_name as string | null) ?? "Not attributed",
    company: String(r.company),
    phone: String(r.phone),
    listName: String(r.list_name),
    region: (r.region as "sg" | "us" | "gb" | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    callbackAt: r.callback_at === null ? null : String(r.callback_at),
    recordingId: (r.recording_id as string | null) ?? null,
    recordingMs: r.recording_ms === null ? null : n(r.recording_ms),
  }));
}
