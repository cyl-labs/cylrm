import { sql } from "drizzle-orm";
import { db } from "@/db";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export type CallOutcome =
  | "no_answer"
  | "voicemail"
  | "gatekeeper"
  | "callback"
  | "not_interested"
  | "interested"
  | "demo_booked"
  | "bad_number";

/** Outcomes that take a lead out of the queue. Mirrors TERMINAL_CALL_OUTCOMES
 *  in the schema; kept as SQL here so the queue filter is one expression. */
const TERMINAL = sql`('not_interested','interested','demo_booked','bad_number')`;

/**
 * The most recent call per lead.
 *
 * A lead's state is derived from its latest call rather than stored on the
 * lead, so correcting a mis-tapped outcome is just logging again — there is no
 * second copy to fall out of step.
 */
const latestCall = sql`
  left join lateral (
    select c.outcome, c.called_at, c.callback_at, c.notes
    from call c
    where c.call_lead_id = l.id
    order by c.called_at desc, c.id desc
    limit 1
  ) lc on true
`;

export type CallListSummary = {
  id: number;
  name: string;
  niche: string | null;
  createdAt: string;
  total: number;
  /** Never dialled. */
  uncalled: number;
  /** Dialled, still in the queue (no answer, voicemail, gatekeeper, callback). */
  working: number;
  /** Finished with, either way. */
  closed: number;
  interested: number;
  demoBooked: number;
  callbacksDue: number;
  /** Numbers already on another list. Held out of the queue, not deleted. */
  duplicates: number;
};

export async function getCallLists(): Promise<CallListSummary[]> {
  // Every aggregate counts l.id rather than *, because a list whose leads are
  // all duplicates joins to no rows and a LEFT JOIN then hands back one row of
  // NULLs. count(*) scores that phantom as an uncalled lead, which made an
  // empty list read "-1 of 0 worked".
  const rows = (await db.execute(sql`
    select cl.id, cl.name, cl.niche, cl.created_at,
      count(l.id) as total,
      count(l.id) filter (where lc.outcome is null) as uncalled,
      count(l.id) filter (where lc.outcome is not null and lc.outcome not in ${TERMINAL}) as working,
      count(l.id) filter (where lc.outcome in ${TERMINAL}) as closed,
      count(l.id) filter (where lc.outcome = 'interested') as interested,
      count(l.id) filter (where lc.outcome = 'demo_booked') as demo_booked,
      count(l.id) filter (where lc.outcome = 'callback' and lc.callback_at <= now()) as callbacks_due,
      (select count(*) from call_lead d
        where d.call_list_id = cl.id and d.duplicate_of_lead_id is not null) as duplicates
    from call_list cl
    left join call_lead l
      on l.call_list_id = cl.id and l.duplicate_of_lead_id is null
    ${latestCall}
    group by cl.id, cl.name, cl.niche, cl.created_at
    order by cl.created_at desc, cl.id desc
  `)) as Row[];

  return rows.map((r) => ({
    id: n(r.id),
    name: String(r.name),
    niche: (r.niche as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    total: n(r.total),
    uncalled: n(r.uncalled),
    working: n(r.working),
    closed: n(r.closed),
    interested: n(r.interested),
    demoBooked: n(r.demo_booked),
    callbacksDue: n(r.callbacks_due),
    duplicates: n(r.duplicates),
  }));
}

export type QueueLead = {
  id: number;
  phone: string;
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  attempts: number;
  lastOutcome: CallOutcome | null;
  lastCalledAt: string | null;
  callbackAt: string | null;
  lastNotes: string | null;
};

export type CallQueueFilter = "queue" | "callbacks" | "closed" | "all";

/**
 * Leads for the dialler, in the order they should be worked.
 *
 * Callbacks that are due come first — someone asked to be rung at a time and
 * that time has passed. Then leads never tried, then everything else oldest
 * attempt first, so nobody gets rung twice while others sit untouched.
 */
export async function getCallQueue(
  callListId: number,
  filter: CallQueueFilter = "queue",
): Promise<QueueLead[]> {
  const where =
    filter === "queue"
      ? sql`and (lc.outcome is null or lc.outcome not in ${TERMINAL})`
      : filter === "callbacks"
        ? sql`and lc.outcome = 'callback'`
        : filter === "closed"
          ? sql`and lc.outcome in ${TERMINAL}`
          : sql``;

  const rows = (await db.execute(sql`
    select l.id, l.phone, l.name, l.company, l.title, l.email,
      lc.outcome as last_outcome, lc.called_at as last_called_at,
      lc.callback_at, lc.notes as last_notes,
      (select count(*) from call c where c.call_lead_id = l.id) as attempts
    from call_lead l
    ${latestCall}
    where l.call_list_id = ${callListId}
      and l.duplicate_of_lead_id is null
      ${where}
    order by
      (lc.outcome = 'callback' and lc.callback_at <= now()) desc,
      (lc.outcome is null) desc,
      lc.called_at asc nulls first,
      l.id asc
    limit 500
  `)) as Row[];

  return rows.map((r) => ({
    id: n(r.id),
    phone: String(r.phone),
    name: (r.name as string | null) ?? null,
    company: (r.company as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    attempts: n(r.attempts),
    lastOutcome: (r.last_outcome as CallOutcome | null) ?? null,
    lastCalledAt: r.last_called_at
      ? new Date(r.last_called_at as string).toISOString()
      : null,
    callbackAt: r.callback_at
      ? new Date(r.callback_at as string).toISOString()
      : null,
    lastNotes: (r.last_notes as string | null) ?? null,
  }));
}

export type CallListDetail = {
  id: number;
  name: string;
  niche: string | null;
  calledToday: number;
} & Pick<
  CallListSummary,
  | "total"
  | "uncalled"
  | "working"
  | "closed"
  | "interested"
  | "demoBooked"
  | "callbacksDue"
  | "duplicates"
>;

export async function getCallList(id: number): Promise<CallListDetail | null> {
  const lists = await getCallLists();
  const found = lists.find((l) => l.id === id);
  if (!found) return null;

  const [today] = (await db.execute(sql`
    select count(*) as called_today
    from call c
    join call_lead l on l.id = c.call_lead_id
    where l.call_list_id = ${id} and c.called_at >= date_trunc('day', now())
  `)) as Row[];

  return { ...found, calledToday: n(today?.called_today) };
}

/** Digits only, so "+65 6123 4567" and "6561234567" are one number. */
export function phoneKey(raw: string): string {
  return raw.replace(/\D/g, "");
}
