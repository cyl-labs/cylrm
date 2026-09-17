import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { callLead } from "@/db/schema";
import { findSameBusiness } from "@/lib/business-match.mjs";
import type { CallOutcome } from "@/lib/calls";
import { placeLabel } from "@/lib/place";

/**
 * The same business on more than one lead, for a founder to confirm.
 *
 * The rules are in `business-match.mjs`; this is the database side of them.
 * Two screens use it: the importer, which checks a file's rows against what
 * the CRM already holds, and the same-business review on Call lists, which
 * checks the leads already in the CRM against each other. See
 * `docs/cold-calling.md`, "The same business under another number".
 */

export type MatchReason = "name" | "prefix" | "website";

type Row = Record<string, unknown>;

/** A lead with just what the comparison and the review need. */
export type BusinessLead = {
  id: number;
  listName: string;
  owner: string | null;
  company: string | null;
  phone: string;
  phoneKey: string;
  website: string | null;
  state: string | null;
  city: string | null;
  duplicateOfLeadId: number | null;
  lastOutcome: CallOutcome | null;
  calls: number;
  /** Its latest call said the number is wrong. Never offered as the copy to
   *  keep: the business may only be reachable on the other number. */
  unreachable: boolean;
};

/** One lead as a review screen shows it. `id` is null for a row of a file
 *  that has not been imported yet. */
export type LookalikeLead = {
  id: number | null;
  company: string | null;
  phone: string;
  where: string | null;
  list: string | null;
  owner: string | null;
  lastOutcome: CallOutcome | null;
};

/** A row of a file being imported that may be a business already held. */
export type SameBusinessRow = {
  /** The row's phone key, which is how a confirmation names it. */
  key: string;
  company: string | null;
  phone: string;
  where: string | null;
  looksLike: (LookalikeLead & { reason: MatchReason })[];
  /** Further matches not listed. */
  more: number;
};

export type SameBusinessGroup = {
  keep: LookalikeLead;
  /** Nobody has rung these. Ticking one holds it out of every queue as a
   *  duplicate of `keep`. */
  candidates: (LookalikeLead & { id: number; reason: MatchReason })[];
};

export function asLookalike(lead: BusinessLead): LookalikeLead {
  return {
    id: lead.id,
    company: lead.company,
    phone: lead.phone,
    where: placeLabel(lead),
    list: lead.listName,
    owner: lead.owner,
    lastOutcome: lead.lastOutcome,
  };
}

/**
 * Every lead in the CRM, in id order, which is the order the matcher compares
 * in — so the lead imported first is the one the rest are said to look like.
 *
 * The latest call and the call count come from two grouped passes over `call`
 * rather than a lateral per lead, for the reason `getCallLists` is written
 * that way: a subquery per lead over thousands of leads is seconds.
 */
export async function loadBusinessLeads(): Promise<BusinessLead[]> {
  const rows = (await db.execute(sql`
    with latest as (
      select distinct on (c.call_lead_id) c.call_lead_id, c.outcome
      from "call" c
      order by c.call_lead_id, c.called_at desc, c.id desc
    ),
    tries as (
      select c.call_lead_id, count(*) as n from "call" c group by c.call_lead_id
    )
    select l.id, cl.name as list_name, u.name as owner, l.company, l.phone,
      l.phone_key, l.website, l.source_fields->>'state' as state,
      l.source_fields->>'city' as city, l.duplicate_of_lead_id,
      latest.outcome as last_outcome, coalesce(tries.n, 0) as calls
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    left join app_user u on u.id = cl.assigned_user_id
    left join latest on latest.call_lead_id = l.id
    left join tries on tries.call_lead_id = l.id
    order by l.id
  `)) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    listName: String(r.list_name),
    owner: (r.owner as string | null) ?? null,
    company: (r.company as string | null) ?? null,
    phone: String(r.phone),
    phoneKey: String(r.phone_key),
    website: (r.website as string | null) ?? null,
    state: (r.state as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    duplicateOfLeadId:
      r.duplicate_of_lead_id === null ? null : Number(r.duplicate_of_lead_id),
    lastOutcome: (r.last_outcome as CallOutcome | null) ?? null,
    calls: Number(r.calls),
    unreachable: r.last_outcome === "bad_number",
  }));
}

/**
 * The businesses the CRM already holds more than once, and which copy to keep.
 *
 * Grouped, because one business can be on five leads and each of them looks
 * like the others: Empire State Junk Removal was twelve. Within a group the
 * copy kept is the first one somebody has rung (and whose number worked),
 * since that is where the history is; failing that, the first imported.
 *
 * **Only leads nobody has rung are offered.** Flagging a lead as a duplicate
 * takes it off the board and out of the list's counts, so a lead with calls on
 * it would take a record of work with it. Those stay as they are.
 */
export async function getSameBusinessGroups(
  leads?: BusinessLead[],
): Promise<SameBusinessGroup[]> {
  const all = leads ?? (await loadBusinessLeads());
  // Leads already flagged are settled; they take no part.
  const live = all.filter((l) => l.duplicateOfLeadId === null);
  const pairs = findSameBusiness(live);

  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    parent.set(id, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  // Why each lead is in its group, from its own first match — or, for the
  // earliest lead, from the first lead that matched it.
  const reasonOf = new Map<number, MatchReason>();
  for (const [lead, matches] of pairs) {
    for (const m of matches) {
      union(lead.id, m.entry.id);
      if (!reasonOf.has(lead.id)) reasonOf.set(lead.id, m.reason);
      if (!reasonOf.has(m.entry.id)) reasonOf.set(m.entry.id, m.reason);
    }
  }

  const groups = new Map<number, BusinessLead[]>();
  for (const lead of live) {
    if (!reasonOf.has(lead.id)) continue;
    const root = find(lead.id);
    const members = groups.get(root);
    if (members) members.push(lead);
    else groups.set(root, [lead]);
  }

  const out: SameBusinessGroup[] = [];
  for (const members of groups.values()) {
    const keep =
      members.find((l) => l.calls > 0 && !l.unreachable) ??
      members.find((l) => l.calls === 0);
    if (!keep) continue;
    const candidates = members
      .filter((l) => l !== keep && l.calls === 0)
      .map((l) => ({ ...asLookalike(l), id: l.id, reason: reasonOf.get(l.id)! }));
    if (candidates.length === 0) continue;
    out.push({ keep: asLookalike(keep), candidates });
  }
  // Biggest first: those are the businesses most likely to be rung twice.
  return out.sort((a, b) => b.candidates.length - a.candidates.length);
}

/**
 * Hold the ticked leads out of every queue as copies of their group's keeper.
 *
 * The groups are worked out again here rather than trusted from the browser,
 * so a lead is only ever flagged if it is still a candidate now — not rung in
 * the minutes the review was open, not already flagged — and always against
 * the keeper the server would choose. Returns how many were flagged.
 */
export async function holdOutSameBusiness(leadIds: number[]): Promise<number> {
  const wanted = new Set(leadIds);
  const groups = await getSameBusinessGroups();
  const byKeeper = new Map<number, number[]>();
  for (const g of groups) {
    const ids = g.candidates.map((c) => c.id).filter((id) => wanted.has(id));
    if (ids.length > 0 && g.keep.id !== null) byKeeper.set(g.keep.id, ids);
  }

  let flagged = 0;
  await db.transaction(async (tx) => {
    for (const [keepId, ids] of byKeeper) {
      const done = await tx
        .update(callLead)
        .set({ duplicateOfLeadId: keepId })
        .where(
          and(
            inArray(callLead.id, ids),
            isNull(callLead.duplicateOfLeadId),
            // Written out rather than interpolated: see the Gotchas on
            // Drizzle columns inside subqueries.
            sql`not exists (select 1 from "call" c where c.call_lead_id = "call_lead"."id")`,
          ),
        )
        .returning({ id: callLead.id });
      flagged += done.length;
      // Anything that was a copy of a lead just held out becomes a copy of
      // the keeper instead, so a flag always points one step at the lead that
      // is worked — the importer follows exactly one.
      if (done.length > 0) {
        await tx
          .update(callLead)
          .set({ duplicateOfLeadId: keepId })
          .where(
            inArray(
              callLead.duplicateOfLeadId,
              done.map((d) => d.id),
            ),
          );
      }
    }
  });
  return flagged;
}
