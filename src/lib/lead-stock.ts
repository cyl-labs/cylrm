import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CallListSummary } from "@/lib/calls";
import { listProgress } from "@/lib/list-sort";
import { nicheOf } from "@/lib/niche";

/**
 * How many leads are left to ring — per caller, and per niche.
 *
 * Two readings of one set of numbers, both on the Team screen:
 *
 *  - **Per caller**, so the Call lists column can draw how far through each of
 *    their lists is. A caller with every list at full is out of work by the
 *    end of the day and nothing else on the screen says so.
 *  - **Per niche**, so "are we running out of leads" has an answer before the
 *    floor hits the bottom of the pile rather than the morning after.
 *
 * Both are built from `getCallLists`, whose numbers the Call lists cards
 * already draw, rather than from a second count of the same rows: Team saying
 * 62% where the card says 48% is worse than Team saying nothing.
 */

/** One of a person's lists, as the Team row draws it. */
export type TeamList = {
  id: number;
  name: string;
  total: number;
  /** Still in the queue: never rung, owed a retry, or a callback due. Exactly
   *  what the card's bar leaves unfilled. */
  leftToCall: number;
  /** Never dialled at all. The part that cannot be manufactured — a retry is
   *  work, but only a fresh lead is a new business to reach. */
  uncalled: number;
  /** 0 to 1, `listProgress` — the same arithmetic as the card and the sort. */
  fraction: number;
};

/**
 * Each person's lists, biggest queue first.
 *
 * Unassigned lists are dropped here and counted by `buildLeadStock` instead:
 * nobody's list belongs on nobody's row, but it is still stock.
 */
export function listsByOwner(
  lists: CallListSummary[],
): Record<number, TeamList[]> {
  const by: Record<number, TeamList[]> = {};
  for (const l of lists) {
    if (l.assignedUserId === null) continue;
    const { leftToCall, fraction } = listProgress(l);
    (by[l.assignedUserId] ??= []).push({
      id: l.id,
      name: l.name,
      total: l.total,
      leftToCall,
      uncalled: l.uncalled,
      fraction,
    });
  }
  for (const rows of Object.values(by)) {
    // Most left to call first: that is the list they will be on longest, and
    // the one at the bottom is the one about to run dry.
    rows.sort((a, b) => b.leftToCall - a.leftToCall || a.name.localeCompare(b.name));
  }
  return by;
}

/** One niche — every list sharing a name, added up. */
export type NicheStock = {
  niche: string;
  lists: number;
  /** Lists in this niche nobody holds. Stock, not work: they are invisible to
   *  every caller until an admin assigns them. */
  spareLists: number;
  total: number;
  done: number;
  fraction: number;
  leftToCall: number;
  /** Never rung, across the whole niche. */
  uncalled: number;
  /** Never rung, on the lists nobody holds — what there is left to hand out. */
  spare: number;
  /** Who is working it, alphabetically. Switched-off people hold lists too. */
  callers: string[];
  /** New leads started a day, over the days the floor actually rang this
   *  niche. Zero means nobody has touched it this week. */
  perDay: number;
  /** Days of never-rung leads left at that rate. Null when nothing is being
   *  rung — a niche nobody is calling is not running out of anything. */
  daysLeft: number | null;
};

/**
 * Leads rung for the first time in the window, per list, and how many days the
 * floor actually worked.
 *
 * **First calls, not calls.** A lead takes up to four dials before it leaves
 * the queue, so counting calls says how loud the floor was, not how fast it is
 * eating the pile. What runs out is businesses nobody has spoken to yet, and
 * one of those is consumed exactly once — the first time it is rung.
 *
 * **Divided by days worked, not by seven.** The floor takes days off; dividing
 * a six-day week by seven quietly reports a rate nobody is dialling at and
 * buys a day of leads that is not there.
 *
 * Duplicates are excluded to agree with `getCallLists`, which holds them out
 * of `total` — a niche cannot burn through a lead that is never offered.
 */
export async function freshStarts(
  tz: string,
  days = 7,
): Promise<{ started: Map<number, number>; activeDays: number }> {
  const since = sql`now() - (${days}::int * interval '1 day')`;
  const rows = (await db.execute(sql`
    with first_call as (
      select call_lead_id, min(called_at) as first_at
      from "call"
      group by call_lead_id
    )
    select l.call_list_id as list_id, count(*)::int as started
    from first_call f
    join call_lead l on l.id = f.call_lead_id
    where f.first_at >= ${since} and l.duplicate_of_lead_id is null
    group by l.call_list_id
  `)) as { list_id: number; started: number }[];

  const [{ days: activeDays } = { days: 0 }] = (await db.execute(sql`
    select count(distinct (called_at at time zone ${tz})::date)::int as days
    from "call"
    where called_at >= ${since}
  `)) as { days: number }[];

  return {
    started: new Map(rows.map((r) => [Number(r.list_id), Number(r.started)])),
    activeDays: Number(activeDays ?? 0),
  };
}

/**
 * Every niche, the ones running out first.
 *
 * Sorted by how long it has left rather than by size, because the row that has
 * to be acted on is the one about to empty. Niches nobody is calling sort
 * last, biggest first: they are the reserve, and the question they answer is
 * "what could I hand out", not "what is urgent".
 */
export function buildLeadStock(
  lists: CallListSummary[],
  started: Map<number, number>,
  activeDays: number,
): NicheStock[] {
  const by = new Map<string, NicheStock & { startedTotal: number; who: Set<string> }>();
  for (const l of lists) {
    const key = nicheOf(l.name);
    const g =
      by.get(key) ??
      ({
        niche: key,
        lists: 0,
        spareLists: 0,
        total: 0,
        done: 0,
        fraction: 0,
        leftToCall: 0,
        uncalled: 0,
        spare: 0,
        callers: [],
        perDay: 0,
        daysLeft: null,
        startedTotal: 0,
        who: new Set<string>(),
      } as NicheStock & { startedTotal: number; who: Set<string> });
    const { leftToCall, done } = listProgress(l);
    g.lists += 1;
    g.total += l.total;
    g.done += done;
    g.leftToCall += leftToCall;
    g.uncalled += l.uncalled;
    g.startedTotal += started.get(l.id) ?? 0;
    if (l.assignedUserId === null) {
      g.spareLists += 1;
      g.spare += l.uncalled;
    } else if (l.assignedName) {
      g.who.add(l.assignedName);
    }
    by.set(key, g);
  }

  const rows = [...by.values()].map((g) => {
    const perDay = activeDays > 0 ? g.startedTotal / activeDays : 0;
    return {
      ...g,
      callers: [...g.who].sort((a, b) => a.localeCompare(b)),
      fraction: g.total === 0 ? 0 : g.done / g.total,
      perDay,
      // Rounded, never floored to zero: "0 days" reads as a mistake where
      // "under a day" reads as the emergency it is.
      daysLeft: perDay > 0 ? g.uncalled / perDay : null,
    };
  });

  return rows.sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return b.total - a.total;
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft;
  });
}
