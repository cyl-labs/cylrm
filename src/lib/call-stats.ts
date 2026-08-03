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
const PICKUP = sql`('gatekeeper','callback','not_interested','interested','demo_booked')`;

export type CallTotals = {
  /** Calls logged in the range — attempts, not leads. */
  calls: number;
  /** Distinct leads those calls were to. */
  leadsDialled: number;
  pickups: number;
  interested: number;
  demos: number;
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
  interested: number;
  demos: number;
};

const since = (days: number | null): SQL =>
  days === null
    ? sql`true`
    : sql`c.called_at >= now() - ${`${days} days`}::interval`;

export async function getCallTotals(days: number | null): Promise<CallTotals> {
  const [row] = (await db.execute(sql`
    select
      count(*) as calls,
      count(distinct c.call_lead_id) as leads_dialled,
      count(*) filter (where c.outcome in ${PICKUP}) as pickups,
      -- Distinct leads for the outcomes that are a result rather than an
      -- event: logging "interested" twice for one business is one interested
      -- business, and counting the calls would say two.
      count(distinct c.call_lead_id) filter (where c.outcome = 'interested') as interested,
      count(distinct c.call_lead_id) filter (where c.outcome = 'demo_booked') as demos,
      count(distinct c.call_lead_id) filter (where c.outcome = 'bad_number') as bad_numbers
    from call c
    where ${since(days)}
  `)) as Row[];

  return {
    calls: n(row?.calls),
    leadsDialled: n(row?.leads_dialled),
    pickups: n(row?.pickups),
    interested: n(row?.interested),
    demos: n(row?.demos),
    badNumbers: n(row?.bad_numbers),
  };
}

export async function getOutcomeCounts(
  days: number | null,
): Promise<OutcomeCount[]> {
  const rows = (await db.execute(sql`
    select c.outcome, count(*) as calls
    from call c
    where ${since(days)}
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
export async function getListStats(days: number | null): Promise<ListStat[]> {
  const rows = (await db.execute(sql`
    select cl.id, cl.name,
      count(distinct l.id) as leads,
      count(distinct l.id) filter (where ever.called) as worked,
      count(c.id) filter (where ${since(days)}) as calls,
      count(c.id) filter (where ${since(days)} and c.outcome in ${PICKUP}) as pickups,
      count(distinct c.call_lead_id) filter (
        where ${since(days)} and c.outcome = 'interested'
      ) as interested,
      count(distinct c.call_lead_id) filter (
        where ${since(days)} and c.outcome = 'demo_booked'
      ) as demos
    from call_list cl
    left join call_lead l
      on l.call_list_id = cl.id and l.duplicate_of_lead_id is null
    left join lateral (
      select true as called
      from call x where x.call_lead_id = l.id limit 1
    ) ever on true
    left join call c on c.call_lead_id = l.id
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
    interested: n(r.interested),
    demos: n(r.demos),
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
export async function getCallsByDay(days: number): Promise<DayStat[]> {
  const rows = (await db.execute(sql`
    select d::date as day,
      count(c.id) as calls,
      count(c.id) filter (where c.outcome in ${PICKUP}) as pickups
    from generate_series(
      date_trunc('day', now()) - ${`${days - 1} days`}::interval,
      date_trunc('day', now()),
      '1 day'
    ) d
    left join call c on date_trunc('day', c.called_at) = d
    group by d
    order by d asc
  `)) as Row[];

  return rows.map((r) => ({
    day: new Date(r.day as string).toISOString().slice(0, 10),
    calls: n(r.calls),
    pickups: n(r.pickups),
  }));
}
