import { sql } from "drizzle-orm";
import { db } from "@/db";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export type CallOutcome =
  | "no_answer"
  | "voicemail"
  | "callback"
  | "not_interested"
  | "demo_booked"
  | "trial"
  | "won"
  | "lost"
  | "bad_number";

/** Outcomes that take a lead out of the queue. Mirrors TERMINAL_CALL_OUTCOMES
 *  in the schema; kept as SQL here so the queue filter is one expression. */
const TERMINAL = sql`('not_interested','demo_booked','trial','won','lost','bad_number')`;

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
  /** Dialled, still in the queue (no answer, voicemail, callback). */
  working: number;
  /** Finished with — everything from a booked demo onwards, plus the noes. */
  closed: number;
  demoBooked: number;
  /** In a trial, or signed. What the calling is actually for. */
  trials: number;
  won: number;
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
      count(l.id) filter (where lc.outcome = 'demo_booked') as demo_booked,
      count(l.id) filter (where lc.outcome = 'trial') as trials,
      count(l.id) filter (where lc.outcome = 'won') as won,
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
    demoBooked: n(r.demo_booked),
    trials: n(r.trials),
    won: n(r.won),
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

/** What the sheet groups by: every outcome, plus "never called".
 *  The list of them and the label map live in `components/calls/outcome.ts`,
 *  which the browser can import — this module reaches for the database. */
export type CallCategory = CallOutcome | "uncalled";

/** Columns every lead view needs. Kept in one place so the queue and the
 *  sheet cannot drift into showing different fields for the same lead. */
const leadColumns = sql`
  l.id, l.phone, l.name, l.company, l.title, l.email,
  lc.outcome as last_outcome, lc.called_at as last_called_at,
  lc.callback_at, lc.notes as last_notes,
  (select count(*) from call c where c.call_lead_id = l.id) as attempts
`;

function toLead(r: Row): QueueLead {
  return {
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
  };
}

/** A row in the spreadsheet, which spans every list at once and so has to say
 *  which one each lead came from. */
export type SheetLead = QueueLead & { listId: number; listName: string };

/** Ceiling on the spreadsheet. Every tab, filter and search runs in the
 *  browser off one payload, so this is what bounds it; the grid says when it
 *  bites rather than quietly showing part of a list. */
export const CALL_SHEET_LIMIT = 5000;

/**
 * Every lead in the Call CRM, in spreadsheet order.
 *
 * Deliberately not the queue's order: the queue answers "who do I ring next",
 * the sheet answers "what is on these lists", so it reads by list and then
 * alphabetically by company, the way the imported CSV would.
 *
 * Duplicates stay out for the same reason they stay out of the queue — the
 * row is a second copy of a number already on another list, and showing it
 * would double-count the business.
 */
export async function getSheetLeads(): Promise<SheetLead[]> {
  const rows = (await db.execute(sql`
    select ${leadColumns}, cl.id as list_id, cl.name as list_name
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    ${latestCall}
    where l.duplicate_of_lead_id is null
    order by cl.name asc,
      coalesce(nullif(l.company, ''), nullif(l.name, ''), l.phone) asc,
      l.id asc
    limit ${CALL_SHEET_LIMIT}
  `)) as Row[];

  return rows.map((r) => ({
    ...toLead(r),
    listId: n(r.list_id),
    listName: String(r.list_name),
  }));
}

/**
 * Where a lead sits on the calling board.
 *
 * Deliberately coarser than the outcome enum: the three ways of not reaching
 * anybody are one column, because on a board they mean the same thing — try
 * again — and the three ways of ending with no sale are one Lost column for
 * the same reason.
 */
export type CallStage =
  | "to_call"
  | "tried"
  | "callback"
  | "demo_booked"
  | "trial"
  | "won"
  | "lost";

export function stageOf(outcome: CallOutcome | null): CallStage {
  if (outcome === null) return "to_call";
  if (outcome === "callback") return "callback";
  if (outcome === "demo_booked") return "demo_booked";
  if (outcome === "trial") return "trial";
  if (outcome === "won") return "won";
  // Three ways of ending with no sale — refused on the phone, a number that
  // was never theirs, or a trial that did not convert — and on a board they
  // all mean the same thing.
  if (outcome === "lost" || outcome === "not_interested" || outcome === "bad_number") {
    return "lost";
  }
  return "tried";
}

export type BoardCard = SheetLead & { stage: CallStage };

/** Cards kept per column. A list of a thousand uncalled numbers is a queue,
 *  not a board, and rendering it as one helps nobody — the column says how
 *  many were left out. */
export const BOARD_COLUMN_LIMIT = 60;

/**
 * The calling board: every lead, most recently touched first.
 *
 * Nothing is held back now that Lost is a column of its own — a board with a
 * Won column and no Lost one only shows the half of the answer you wanted to
 * hear. The per-column cap is what keeps it readable.
 */
export async function getCallBoard(listId?: number): Promise<BoardCard[]> {
  const inList = listId ? sql`and l.call_list_id = ${listId}` : sql``;

  const rows = (await db.execute(sql`
    select ${leadColumns}, cl.id as list_id, cl.name as list_name
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    ${latestCall}
    where l.duplicate_of_lead_id is null
      ${inList}
    order by
      -- Callbacks whose time has passed first, the same priority the dialler
      -- gives them, then whatever was touched most recently.
      (lc.outcome = 'callback' and lc.callback_at <= now()) desc,
      lc.called_at desc nulls last,
      l.id asc
    limit ${CALL_SHEET_LIMIT}
  `)) as Row[];

  return rows.map((r) => {
    const lead = toLead(r);
    return {
      ...lead,
      listId: n(r.list_id),
      listName: String(r.list_name),
      stage: stageOf(lead.lastOutcome),
    };
  });
}

/**
 * Leads for the dialler, in the order they should be worked.
 *
 * Callbacks that are due come first — someone asked to be rung at a time and
 * that time has passed. Then leads never tried, then everything else oldest
 * attempt first, so nobody gets rung twice while others sit untouched.
 */
/** Ceiling on one dialling view. Every lead below the current card is listed,
 *  so this bounds the page as well as the query; the screen says when it
 *  bites rather than calling a partial list "All". */
export const CALL_QUEUE_LIMIT = 500;

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
    select ${leadColumns}
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
    limit ${CALL_QUEUE_LIMIT}
  `)) as Row[];

  return rows.map(toLead);
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
  | "demoBooked"
  | "trials"
  | "won"
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

/**
 * Comparison form of a number: digits only, with bare Singapore numbers
 * given their country code.
 *
 * Scrapes disagree about the prefix — one file writes "+65 6836 1030" and the
 * next writes "6836 1030" for the same line. Without this the two look like
 * different numbers and the same business gets rung from two lists. Eight
 * digits starting 3, 6, 8 or 9 is the SG numbering plan; anything else is left
 * exactly as found rather than guessed at.
 */
export function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8 && /^[3689]/.test(digits)) return `65${digits}`;
  return digits;
}

/**
 * Is this a number that can actually be rung in Singapore?
 *
 * The local eight-digit form has to be tested *before* the "65" country code,
 * because a local landline like 6524 3913 also begins with those two digits.
 * Testing the prefix first brands every 65xx xxxx line malformed.
 */
export function classifyPhone(
  raw: string,
): "sg" | "sg_tollfree" | "foreign" | "malformed" | "missing" {
  const d = raw.replace(/\D/g, "");
  if (!d) return "missing";
  if (d.startsWith("1800")) return "sg_tollfree";
  if (d.length === 8 && /^[3689]/.test(d)) return "sg";
  if (d.length === 10 && d.startsWith("65")) return "sg";
  return d.startsWith("65") ? "malformed" : "foreign";
}
