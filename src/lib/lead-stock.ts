import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CallListSummary } from "@/lib/calls";
import { LEAD_LOW_DAYS } from "@/lib/lead-words";
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
export type Pace = {
  /** Fresh leads started per list, for the niche table. */
  started: Map<number, number>;
  /** Days anybody rang at all, the divisor for a niche. */
  activeDays: number;
  /** Fresh leads a person starts on a day they ring — their own pace, so the
   *  warning on their row is measured against how fast *they* work rather
   *  than the floor's average. Absent means they have rung nothing new this
   *  week: a new hire, or somebody away. */
  perDay: Map<number, number>;
};

export async function freshStarts(tz: string, days = 7): Promise<Pace> {
  const since = sql`now() - (${days}::int * interval '1 day')`;
  // `distinct on` rather than `min(called_at)`, because the person who made
  // the first call has to come back with it — a grouped min cannot say who.
  // The whole table is scanned for that first call and only then filtered to
  // the window: a lead first rung a month ago and rung again yesterday was
  // consumed a month ago, and counting it here would report leads being eaten
  // that are already gone. 10ms on prod's 3,130 calls.
  const rows = (await db.execute(sql`
    with first_call as (
      select distinct on (c.call_lead_id)
        c.call_lead_id, c.user_id, c.called_at as first_at
      from "call" c
      order by c.call_lead_id, c.called_at, c.id
    )
    select f.user_id, l.call_list_id as list_id, count(*)::int as started
    from first_call f
    join call_lead l on l.id = f.call_lead_id
    where f.first_at >= ${since} and l.duplicate_of_lead_id is null
    group by f.user_id, l.call_list_id
  `)) as { user_id: number | null; list_id: number; started: number }[];

  const dayRows = (await db.execute(sql`
    select user_id, count(distinct (called_at at time zone ${tz})::date)::int as days
    from "call"
    where called_at >= ${since}
    group by user_id
  `)) as { user_id: number | null; days: number }[];

  const started = new Map<number, number>();
  const startedBy = new Map<number, number>();
  for (const r of rows) {
    const list = Number(r.list_id);
    started.set(list, (started.get(list) ?? 0) + Number(r.started));
    if (r.user_id !== null) {
      const uid = Number(r.user_id);
      startedBy.set(uid, (startedBy.get(uid) ?? 0) + Number(r.started));
    }
  }

  // Their own working days, not the floor's: somebody back from three days off
  // has not slowed down, and dividing their week by everyone else's would say
  // they had.
  const perDay = new Map<number, number>();
  for (const r of dayRows) {
    if (r.user_id === null) continue;
    const uid = Number(r.user_id);
    const d = Number(r.days);
    if (d > 0 && startedBy.has(uid)) perDay.set(uid, startedBy.get(uid)! / d);
  }
  // The floor's own divisor still has to be days *anybody* rang, which is the
  // union of everyone's, not the sum — a second query for one integer.
  const [{ days: activeDays } = { days: 0 }] = (await db.execute(sql`
    select count(distinct (called_at at time zone ${tz})::date)::int as days
    from "call"
    where called_at >= ${since}
  `)) as { days: number }[];

  return { started, activeDays: Number(activeDays ?? 0), perDay };
}

/** A caller who is about to have nothing new to dial. */
export type ShortCaller = {
  id: number;
  name: string;
  /** Never rung, across every list they hold. */
  uncalled: number;
  /** The lists they hold, by name — what the assign menu reads to offer more
   *  of the niche they already ring. */
  listNames: string[];
  /** Their market, so the menu can sink the lists they cannot work. */
  market: string | null;
  /** Null when they have rung nothing new this week, so no pace to measure
   *  against — then only an empty queue is worth saying out loud. */
  daysLeft: number | null;
  perDay: number;
};

/**
 * Who is running out, worst first.
 *
 * Active callers only. An admin holds the demo line, which is two leads and
 * permanently "out", and a switched-off account's lists are parked rather
 * than being worked — neither is a person to go and fix.
 *
 * A caller with no lists at all is the loudest case and is included with
 * everything at zero: they sign in to an empty app, which is worse than
 * running low.
 */
export function callersRunningOut(
  team: {
    id: number;
    name: string;
    role: string;
    active: boolean;
    callRegion: string | null;
  }[],
  lists: Record<number, TeamList[]>,
  perDay: Map<number, number>,
): ShortCaller[] {
  const out: ShortCaller[] = [];
  for (const p of team) {
    if (!p.active || p.role !== "caller") continue;
    const theirs = lists[p.id] ?? [];
    const uncalled = theirs.reduce((n, l) => n + l.uncalled, 0);
    const rate = perDay.get(p.id) ?? 0;
    const daysLeft = rate > 0 ? uncalled / rate : null;
    // Nothing new to dial is always worth saying. Anything else needs a pace
    // to measure against: without one there is no answer to "how long", only
    // a number that could be a fortnight's work or this afternoon's.
    if (uncalled > 0 && (daysLeft === null || daysLeft >= LEAD_LOW_DAYS)) continue;
    out.push({
      id: p.id,
      name: p.name,
      uncalled,
      listNames: theirs.map((l) => l.name),
      market: p.callRegion,
      daysLeft,
      perDay: rate,
    });
  }
  // Nothing left to dial first, then by how long they have, then by name so
  // the order does not shuffle between refreshes.
  return out.sort(
    (a, b) =>
      (a.daysLeft ?? -1) - (b.daysLeft ?? -1) ||
      a.uncalled - b.uncalled ||
      a.name.localeCompare(b.name),
  );
}

/** An unassigned list, as the assign menu offers it. */
export type PoolList = {
  id: number;
  name: string;
  niche: string;
  region: string | null;
  uncalled: number;
  total: number;
};

/**
 * The lists nobody holds, best to hand out first.
 *
 * Most never-rung first, because that is what a caller who has run out needs;
 * lists with nothing left on them sort to the bottom rather than being hidden,
 * since "there is nothing to give" is an answer too and a silently shortened
 * menu is not.
 */
export function poolOf(lists: CallListSummary[]): PoolList[] {
  return lists
    .filter((l) => l.assignedUserId === null)
    .map((l) => ({
      id: l.id,
      name: l.name,
      niche: nicheOf(l.name),
      region: l.region,
      uncalled: l.uncalled,
      total: l.total,
    }))
    .sort((a, b) => b.uncalled - a.uncalled || a.name.localeCompare(b.name));
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
