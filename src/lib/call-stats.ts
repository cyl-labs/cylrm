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
 * where the data is worst. Voicemail and no answer are not pickups either —
 * nobody was reached.
 */
const PICKUP = sql`('callback','not_interested','demo_booked','trial','won','lost')`;

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

const since = (days: number | null): SQL =>
  days === null
    ? sql`true`
    : sql`c.called_at >= now() - ${`${days} days`}::interval`;

/** Narrow to one niche. Joining through the lead is the only route — `call`
 *  has no list of its own, by design. */
const inList = (listId?: number): SQL =>
  listId
    ? sql`and exists (
        select 1 from call_lead l
        where l.id = c.call_lead_id and l.call_list_id = ${listId}
      )`
    : sql``;

export async function getCallTotals(
  days: number | null,
  listId?: number,
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
    where ${since(days)} ${inList(listId)}
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
  days: number | null,
  listId?: number,
): Promise<OutcomeCount[]> {
  const rows = (await db.execute(sql`
    select c.outcome, count(*) as calls
    from call c
    where ${since(days)} ${inList(listId)}
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
  days: number | null,
  listId?: number,
): Promise<ListStat[]> {
  const rows = (await db.execute(sql`
    select cl.id, cl.name,
      count(distinct l.id) as leads,
      count(distinct l.id) filter (where ever.called) as worked,
      count(c.id) filter (where ${since(days)}) as calls,
      count(c.id) filter (where ${since(days)} and c.outcome in ${PICKUP}) as pickups,
      count(distinct c.call_lead_id) filter (
        where ${since(days)} and c.outcome = 'demo_booked'
      ) as demos,
      count(distinct c.call_lead_id) filter (
        where ${since(days)} and c.outcome = 'trial'
      ) as trials,
      count(distinct c.call_lead_id) filter (
        where ${since(days)} and c.outcome = 'won'
      ) as won
    from call_list cl
    left join call_lead l
      on l.call_list_id = cl.id and l.duplicate_of_lead_id is null
    left join lateral (
      select true as called
      from call x where x.call_lead_id = l.id limit 1
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
): Promise<DayStat[]> {
  const rows = (await db.execute(sql`
    select d::date as day,
      count(c.id) as calls,
      count(c.id) filter (where c.outcome in ${PICKUP}) as pickups
    from generate_series(
      date_trunc('day', now()) - ${`${days - 1} days`}::interval,
      date_trunc('day', now()),
      '1 day'
    ) d
    -- The niche clause belongs in the join, not a WHERE: filtering after the
    -- LEFT JOIN would drop the empty days this series exists to keep.
    left join call c
      on date_trunc('day', c.called_at) = d
      and (${listId ?? null}::int is null or exists (
        select 1 from call_lead l
        where l.id = c.call_lead_id and l.call_list_id = ${listId ?? null}
      ))
    group by d
    order by d asc
  `)) as Row[];

  return rows.map((r) => ({
    day: new Date(r.day as string).toISOString().slice(0, 10),
    calls: n(r.calls),
    pickups: n(r.pickups),
  }));
}
