import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dncBlockReason } from "@/lib/dnc";
import { getCurrentUser } from "@/lib/session";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export type CallOutcome =
  | "no_answer"
  | "voicemail"
  | "gatekeeper"
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
 * A callback you can act on now: the time has passed, or none was set.
 *
 * One expression because four places ask the question — the queue, the badge
 * on each list, the sidebar count and the callbacks screen — and they have to
 * agree. A callback with no time cannot be waited for, so it counts as
 * actionable rather than disappearing until someone sets one.
 */
const CALLBACK_DUE = sql`(lc.callback_at is null or lc.callback_at <= now())`;

/** Calls are made in Singapore, so "today" is a Singapore day — a 7am call
 *  would otherwise count against yesterday, the droplet being on UTC. */
const CALL_TZ = "Asia/Singapore";

/** Somebody answered. Gatekeeper counts: a receptionist is a person, and
 *  getting past one is the job. Mirrors PICKUP in call-stats. */
const SPOKE_TO = sql`('gatekeeper','callback','not_interested','demo_booked','trial','won','lost')`;

/**
 * The most recent call per lead.
 *
 * A lead's state is derived from its latest call rather than stored on the
 * lead, so correcting a mis-tapped outcome is just logging again — there is no
 * second copy to fall out of step.
 */
const latestCall = sql`
  left join lateral (
    select c.outcome, c.called_at, c.callback_at, c.notes, c.telnyx_session_id,
      -- Who made it. Joined here rather than on the outer query so it stays
      -- the *latest* call's caller, not every caller this lead has had.
      (select u.name from app_user u where u.id = c.user_id) as by_name
    from call c
    where c.call_lead_id = l.id
    order by c.called_at desc, c.id desc
    limit 1
  ) lc on true
  -- What Telnyx recorded of that call, if it was dialled from the browser and
  -- the webhook has landed. Joined out here rather than inside the lateral
  -- above so every screen that shows a lead's last call gets the recording
  -- with it. Latest first: a session can produce more than one file.
  left join lateral (
    select r.recording_id, r.duration_ms
    from call_recording r
    where r.call_session_id = lc.telnyx_session_id
    order by r.started_at desc nulls last, r.id desc
    limit 1
  ) lr on true
`;

export type CallListSummary = {
  id: number;
  name: string;
  niche: string | null;
  createdAt: string;
  total: number;
  /** Never dialled. */
  uncalled: number;
  /** Calls logged today — is anyone actually working this list. The three
   *  below partition it: every call today is exactly one of them. */
  calledToday: number;
  /** Somebody answered. */
  conversationsToday: number;
  /** Rang out or went to voicemail. */
  noAnswerToday: number;
  /** The number was wrong. */
  badNumbersToday: number;
  /** Rung, nobody reached, still worth ringing: no answer, voicemail,
   *  gatekeeper. Callbacks are counted separately — they have a time. */
  toRetry: number;
  /** Said no, or the line was wrong, or a trial that did not convert. Named
   *  for what happened rather than "closed", which counted a booked demo as
   *  finished business alongside a wrong number. */
  ruledOut: number;
  demoBooked: number;
  /** In a trial, or signed. What the calling is actually for. */
  trials: number;
  won: number;
  /** Owed a call back now — the time has passed, or none was set. In the
   *  queue. */
  callbacksDue: number;
  /** Owed a call back at a time still ahead. Deliberately out of the queue
   *  until then. */
  callbacksLater: number;
  /** Numbers already on another list. Held out of the queue, not deleted. */
  duplicates: number;
  /** Who this niche belongs to. Null means nobody's in particular — a label,
   *  not a lock; anyone can still work any list. */
  assignedUserId: number | null;
  assignedName: string | null;
  /** Which folder it files under on the lists screen. Null is unfiled. */
  region: CallRegion | null;
  /** Every call ever logged against this list's leads. Only the delete
   *  confirmation reads it — the number it has to say out loud is what would
   *  be destroyed, and that is history rather than today's activity. */
  callsLogged: number;
};

/**
 * Narrow a query to the niches one person owns.
 *
 * Callers see only what has been assigned to them. The earlier "a label, not
 * a lock" rule is reversed: an employee has no business in a niche that is
 * not theirs, and fourteen of other people's made the screen a wall. Admins
 * pass `undefined` and see everything.
 *
 * Expects the query to have `call_list` aliased as `cl`.
 */
const ownedBy = (ownerId?: number) =>
  ownerId === undefined ? sql`` : sql`and cl.assigned_user_id = ${ownerId}`;

export async function getCallLists(
  ownerId?: number,
): Promise<CallListSummary[]> {
  // Every aggregate counts l.id rather than *, because a list whose leads are
  // all duplicates joins to no rows and a LEFT JOIN then hands back one row of
  // NULLs. count(*) scores that phantom as an uncalled lead, which made an
  // empty list read "-1 of 0 worked".
  const rows = (await db.execute(sql`
    select cl.id, cl.name, cl.niche, cl.created_at, cl.region,
      cl.assigned_user_id,
      (select u.name from app_user u where u.id = cl.assigned_user_id) as assigned_name,
      count(l.id) as total,
      count(l.id) filter (where lc.outcome is null) as uncalled,
      count(l.id) filter (
        where lc.outcome in ('no_answer','voicemail','gatekeeper')
      ) as to_retry,
      count(l.id) filter (
        where lc.outcome in ('not_interested','bad_number','lost')
      ) as ruled_out,
      (select count(*) from call c
        join call_lead cll on cll.id = c.call_lead_id
        where cll.call_list_id = cl.id
          and (c.called_at at time zone ${CALL_TZ})::date
              = (now() at time zone ${CALL_TZ})::date) as called_today,
      (select count(*) from call c
        join call_lead cll on cll.id = c.call_lead_id
        where cll.call_list_id = cl.id
          and (c.called_at at time zone ${CALL_TZ})::date
              = (now() at time zone ${CALL_TZ})::date
          and c.outcome in ${SPOKE_TO}) as conversations_today,
      (select count(*) from call c
        join call_lead cll on cll.id = c.call_lead_id
        where cll.call_list_id = cl.id
          and (c.called_at at time zone ${CALL_TZ})::date
              = (now() at time zone ${CALL_TZ})::date
          and c.outcome in ('no_answer','voicemail')) as no_answer_today,
      (select count(*) from call c
        join call_lead cll on cll.id = c.call_lead_id
        where cll.call_list_id = cl.id
          and (c.called_at at time zone ${CALL_TZ})::date
              = (now() at time zone ${CALL_TZ})::date
          and c.outcome = 'bad_number') as bad_numbers_today,
      count(l.id) filter (where lc.outcome = 'demo_booked') as demo_booked,
      count(l.id) filter (where lc.outcome = 'trial') as trials,
      count(l.id) filter (where lc.outcome = 'won') as won,
      count(l.id) filter (where lc.outcome = 'callback' and ${CALLBACK_DUE}) as callbacks_due,
      count(l.id) filter (
        where lc.outcome = 'callback' and lc.callback_at > now()
      ) as callbacks_later,
      (select count(*) from call_lead d
        where d.call_list_id = cl.id and d.duplicate_of_lead_id is not null) as duplicates,
      (select count(*) from call c
        join call_lead cll on cll.id = c.call_lead_id
        where cll.call_list_id = cl.id) as calls_logged
    from call_list cl
    left join call_lead l
      on l.call_list_id = cl.id and l.duplicate_of_lead_id is null
    ${latestCall}
    where true ${ownedBy(ownerId)}
    group by cl.id, cl.name, cl.niche, cl.created_at, cl.assigned_user_id
    order by cl.created_at desc, cl.id desc
  `)) as Row[];

  return rows.map((r) => ({
    id: n(r.id),
    name: String(r.name),
    niche: (r.niche as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    total: n(r.total),
    uncalled: n(r.uncalled),
    calledToday: n(r.called_today),
    conversationsToday: n(r.conversations_today),
    noAnswerToday: n(r.no_answer_today),
    badNumbersToday: n(r.bad_numbers_today),
    toRetry: n(r.to_retry),
    ruledOut: n(r.ruled_out),
    demoBooked: n(r.demo_booked),
    trials: n(r.trials),
    won: n(r.won),
    callbacksDue: n(r.callbacks_due),
    callbacksLater: n(r.callbacks_later),
    duplicates: n(r.duplicates),
    assignedUserId: r.assigned_user_id === null ? null : n(r.assigned_user_id),
    assignedName: (r.assigned_name as string | null) ?? null,
    region: (r.region as CallRegion | null) ?? null,
    callsLogged: n(r.calls_logged),
  }));
}

export type QueueLead = {
  id: number;
  phone: string;
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  website: string | null;
  attempts: number;
  lastOutcome: CallOutcome | null;
  lastCalledAt: string | null;
  callbackAt: string | null;
  lastNotes: string | null;
  /** Who logged the most recent call. Null for the calls made before staff
   *  logins existed, and for a lead nobody has rung. */
  lastCalledBy: string | null;
  /** Telnyx's id for the last call's recording, resolved to a fresh playable
   *  link by `/api/recordings/[id]`. Null for handset calls, for calls with no
   *  audio, and until the webhook lands. */
  recordingId: string | null;
  /** Length of that recording. Not the length of the call — a no-answer has
   *  no recording at all. */
  recordingMs: number | null;
  /** The number to ring, E.164. Null when it cannot be dialled from here. */
  dialTo: string | null;
  /** The caller ID to present, chosen by the lead's country. Null when no DID
   *  is configured for it, which disables the dial button with a reason. */
  dialFrom: string | null;
  /** Why this number may not be rung at all, or null. Blocks the handset route
   *  as well as the dial button: copying a listed number to ring it from a
   *  desk phone is the same call. Always null for Singapore — see lib/dnc.ts. */
  dncBlock: string | null;
};

export type CallQueueFilter = "queue" | "callbacks" | "closed" | "all";

/** What the sheet groups by: every outcome, plus "never called".
 *  The list of them and the label map live in `components/calls/outcome.ts`,
 *  which the browser can import — this module reaches for the database. */
export type CallCategory = CallOutcome | "uncalled";

/** Columns every lead view needs. Kept in one place so the queue and the
 *  sheet cannot drift into showing different fields for the same lead. */
const leadColumns = sql`
  l.id, l.phone, l.name, l.company, l.title, l.email, l.website,
  l.dnc_status, l.dnc_checked_at,
  lc.outcome as last_outcome, lc.called_at as last_called_at,
  lc.callback_at, lc.notes as last_notes, lc.by_name as last_called_by,
  lr.recording_id, lr.duration_ms as recording_ms,
  (select count(*) from call c where c.call_lead_id = l.id) as attempts
`;

function toLead(r: Row, dids: DidMap): QueueLead {
  return {
    id: n(r.id),
    phone: String(r.phone),
    name: (r.name as string | null) ?? null,
    company: (r.company as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    website: (r.website as string | null) ?? null,
    attempts: n(r.attempts),
    lastOutcome: (r.last_outcome as CallOutcome | null) ?? null,
    lastCalledAt: r.last_called_at
      ? new Date(r.last_called_at as string).toISOString()
      : null,
    callbackAt: r.callback_at
      ? new Date(r.callback_at as string).toISOString()
      : null,
    lastNotes: (r.last_notes as string | null) ?? null,
    lastCalledBy: (r.last_called_by as string | null) ?? null,
    recordingId: (r.recording_id as string | null) ?? null,
    recordingMs: r.recording_ms === null ? null : n(r.recording_ms),
    dialTo: e164(String(r.phone)),
    dialFrom: didFor(dialCountry(String(r.phone)), dids),
    dncBlock: dncBlockReason(
      {
        dncStatus: (r.dnc_status as "clean" | "listed" | null) ?? null,
        dncCheckedAt: r.dnc_checked_at
          ? new Date(r.dnc_checked_at as string).toISOString()
          : null,
      },
      dialCountry(String(r.phone)),
    ),
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
 * Every lead in the Call CRM, most recently called first.
 *
 * The sheet is opened after a session as often as before one — "what did I
 * just do", "what did that number come to" — and an alphabetical wall of
 * companies answered neither. Leads never rung sort last, in list and company
 * order, because that is browsing rather than reviewing.
 *
 * Duplicates stay out for the same reason they stay out of the queue — the
 * row is a second copy of a number already on another list, and showing it
 * would double-count the business.
 */
export async function getSheetLeads(ownerId?: number): Promise<SheetLead[]> {
  const rows = (await db.execute(sql`
    select ${leadColumns}, cl.id as list_id, cl.name as list_name
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    ${latestCall}
    where l.duplicate_of_lead_id is null
      ${ownedBy(ownerId)}
    order by lc.called_at desc nulls last,
      cl.name asc,
      coalesce(nullif(l.company, ''), nullif(l.name, ''), l.phone) asc,
      l.id asc
    limit ${CALL_SHEET_LIMIT}
  `)) as Row[];

  const dids = await getDids();
  return rows.map((r) => ({
    ...toLead(r, dids),
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

/**
 * Every lead waiting to be rung back, soonest first.
 *
 * Across all the lists, because a callback is a promise made at a time, not a
 * property of the niche it came from: at 3pm you want everyone owed a call by
 * 3pm, whichever list they are on. Overdue ones sort to the top for the same
 * reason. A callback with no time set — the API defaults one, but a corrected
 * outcome can leave it null — sorts last rather than being dropped.
 */
export type CallbackLead = SheetLead & {
  /** Whether the time has passed, decided by the database's clock. Read off a
   *  row rather than recomputed while rendering: `Date.now()` during render is
   *  impure, and the server and the browser would answer differently for a
   *  callback due within a minute of the page loading. */
  due: boolean;
};

export async function getCallbacks(
  listId?: number,
  ownerId?: number,
): Promise<CallbackLead[]> {
  const inList = listId ? sql`and l.call_list_id = ${listId}` : sql``;

  const rows = (await db.execute(sql`
    select ${leadColumns}, cl.id as list_id, cl.name as list_name,
      ${CALLBACK_DUE} as due
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    ${latestCall}
    where l.duplicate_of_lead_id is null
      ${inList}
      ${ownedBy(ownerId)}
      and lc.outcome = 'callback'
    order by lc.callback_at asc nulls last, l.id asc
    limit ${CALL_SHEET_LIMIT}
  `)) as Row[];

  const dids = await getDids();
  return rows.map((r) => ({
    ...toLead(r, dids),
    listId: n(r.list_id),
    listName: String(r.list_name),
    due: r.due === true,
  }));
}

/** How many callbacks are owed right now — the sidebar badge. Cached because
 *  the sidebar and `PageShell` both ask while rendering one page, the same
 *  reason `countUnreadReplies` is. */
export const countCallbacksDue = cache(
  async (ownerId?: number): Promise<number> => {
    const [row] = (await db.execute(sql`
      select count(l.id) as n
      from call_lead l
      -- Joined only so \`ownedBy\` has its \`cl\` to filter on; every lead has
      -- exactly one list, so the join cannot change the count.
      join call_list cl on cl.id = l.call_list_id
      ${latestCall}
      where l.duplicate_of_lead_id is null
        ${ownedBy(ownerId)}
        and lc.outcome = 'callback'
        and ${CALLBACK_DUE}
    `)) as Row[];
    return n(row?.n);
  },
);

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
export async function getCallBoard(
  listId?: number,
  ownerId?: number,
): Promise<BoardCard[]> {
  const inList = listId ? sql`and l.call_list_id = ${listId}` : sql``;

  const rows = (await db.execute(sql`
    select ${leadColumns}, cl.id as list_id, cl.name as list_name
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    ${latestCall}
    where l.duplicate_of_lead_id is null
      ${inList}
      ${ownedBy(ownerId)}
    order by
      -- Callbacks whose time has passed first, the same priority the dialler
      -- gives them, then whatever was touched most recently.
      (lc.outcome = 'callback' and (lc.callback_at is null or lc.callback_at <= now())) desc,
      lc.called_at desc nulls last,
      l.id asc
    limit ${CALL_SHEET_LIMIT}
  `)) as Row[];

  const dids = await getDids();
  return rows.map((r) => {
    const lead = toLead(r, dids);
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
      ? // A callback booked for Tuesday is not Monday's work. It leaves the
        // queue when it is logged and comes back when its time passes, which
        // is the whole point of asking for a time.
        sql`and (
          lc.outcome is null
          or (lc.outcome not in ${TERMINAL} and lc.outcome <> 'callback')
          or (lc.outcome = 'callback' and ${CALLBACK_DUE})
        )`
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
      (lc.outcome = 'callback' and (lc.callback_at is null or lc.callback_at <= now())) desc,
      (lc.outcome is null) desc,
      lc.called_at asc nulls first,
      l.id asc
    limit ${CALL_QUEUE_LIMIT}
  `)) as Row[];

  const dids = await getDids();
  return rows.map((r) => toLead(r, dids));
}

/** The summary is already everything the detail screen shows; it stays a
 *  named type because the dialler reads a handful of fields and the list of
 *  them is worth stating. */
export type CallListDetail = {
  id: number;
  name: string;
  niche: string | null;
} & Pick<
  CallListSummary,
  // The dialler falls back to this when the person signed in has no market of
  // their own, which is every admin.
  | "region"
  | "total"
  | "uncalled"
  | "calledToday"
  | "conversationsToday"
  | "noAnswerToday"
  | "badNumbersToday"
  | "toRetry"
  | "ruledOut"
  | "demoBooked"
  | "trials"
  | "won"
  | "callbacksDue"
  | "callbacksLater"
  | "duplicates"
>;

export async function getCallList(
  id: number,
  ownerId?: number,
): Promise<CallListDetail | null> {
  // `called_today` comes back with the summary now, so there is no second
  // query and no chance of the card and the detail screen disagreeing.
  //
  // Scoped, so a caller who types another team's list id into the URL gets the
  // same not-found as a list that never existed — the dialler reads its queue
  // only after this returns.
  const lists = await getCallLists(ownerId);
  return lists.find((l) => l.id === id) ?? null;
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
export function phoneKey(
  raw: string,
  defaultRegion?: CallRegion | null,
): string {
  // Anything we can put in E.164 keys off that, so every way of writing the
  // same line collapses to one value. This matters beyond Singapore now: a UK
  // number carries a trunk "0" that only applies when dialling domestically,
  // so "+44 (0)20 7946 0958" and "+44 20 7946 0958" are one line written two
  // ways, and keying on bare digits would let both into the same list.
  const canonical = e164(raw, defaultRegion);
  if (canonical) return canonical.slice(1);

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8 && /^[3689]/.test(digits)) return `65${digits}`;
  return digits;
}

/**
 * The national part of a UK number, or null if this is not one.
 *
 * Scrapes write the trunk prefix that only applies when dialling inside the
 * country — "+44 (0)20 7946 0958" — and keeping that 0 makes a number that
 * cannot be rung from anywhere. Exactly one is stripped.
 */
function gbNational(digits: string): string | null {
  if (!digits.startsWith("44")) return null;
  const rest = digits.slice(2).replace(/^0/, "");
  return rest.length === 9 || rest.length === 10 ? rest : null;
}

/** A UK number as a Briton writes it: "020 7946 0100", trunk zero and all. */
function gbLocal(digits: string): string | null {
  if (!digits.startsWith("0")) return null;
  const rest = digits.slice(1);
  return rest.length === 9 || rest.length === 10 ? rest : null;
}

/**
 * A North American number as an American writes it: "(907) 659-2550".
 *
 * Neither the area code nor the exchange may start with 0 or 1, which is what
 * stops a ten-digit serial number or a mangled string being read as a phone
 * number just because it is the right length.
 */
function nanpNational(digits: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits);
}

/**
 * Which country's phone system this number belongs to.
 *
 * The local eight-digit form has to be tested *before* the "65" country code,
 * because a local landline like 6524 3913 also begins with those two digits.
 * Testing the prefix first brands every 65xx xxxx line malformed.
 *
 * `us` and `gb` require the country code. A bare ten-digit 4155551234 is
 * indistinguishable from Singapore's own 65xxxxxxxx form, so it stays foreign
 * rather than being guessed at and rung wrong.
 *
 * Known collision, left alone deliberately: Singapore toll-free (1800 + 7
 * digits) and US toll-free (+1 800 + 7) are the same eleven digits, so a US
 * 800 number reads as `sg_tollfree`. Preserving the existing rule matters more
 * — the live base is Singapore — and nobody cold-calls a toll-free line.
 */
/**
 * What kind of number is this, read in the market it came from.
 *
 * `defaultRegion` is the list's own market, and it only ever applies to a
 * number written *without* a country code. Most scraped numbers are national
 * format — Google hands back "(907) 659-2550" for a US business — and with no
 * market to read them in there is nothing to say whether that is American,
 * or a mis-typed something else. A US list of 278 once imported four rows for
 * exactly this reason: the only survivors were Puerto Rico and American Samoa
 * listings, where Google happened to supply international format.
 *
 * An explicit "+" always wins over the default, because it is the one thing
 * in the string that is not a guess.
 */
export function classifyPhone(
  raw: string,
  defaultRegion?: CallRegion | null,
): "sg" | "sg_tollfree" | "us" | "gb" | "foreign" | "malformed" | "missing" {
  const cleaned = raw.replace(/[^\d+]/g, "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "missing";

  // Written with a country code: believe it, and never consult the default.
  if (cleaned.startsWith("+")) {
    if (/^\+1\d{10}$/.test(cleaned)) return "us";
    if (/^\+65\d{8}$/.test(cleaned)) return "sg";
    if (gbNational(d)) return "gb";
    return "foreign";
  }

  // Written the way people in that market write it. Checked before the
  // bare-digit rules below because those collide: a US number in area code
  // 650 or 656 is ten digits beginning "65", which is also how a Singapore
  // number with its country code and no plus looks.
  if (defaultRegion === "us") {
    if (nanpNational(d)) return "us";
    if (d.length === 11 && d.startsWith("1") && nanpNational(d.slice(1))) {
      return "us";
    }
  }
  if (defaultRegion === "gb" && gbLocal(d)) return "gb";
  if (defaultRegion === "sg" && d.length === 8 && /^[3689]/.test(d)) return "sg";

  // Country code present but the plus missing, which is how a lot of scrapes
  // write it. Singapore writes its toll-free numbers 1800 xxx xxxx with no
  // country code and the US writes its own +1 800 xxx xxxx; identical once
  // the digits are stripped, which is why the plus is read first above.
  if (d.startsWith("1800")) return "sg_tollfree";
  if (d.length === 8 && /^[3689]/.test(d)) return "sg";
  if (d.length === 10 && d.startsWith("65")) return "sg";
  if (d.length === 11 && d.startsWith("1")) return "us";
  if (gbNational(d)) return "gb";
  return d.startsWith("65") ? "malformed" : "foreign";
}

/** Countries we can present a caller ID for. */
export type DialCountry = "sg" | "us" | "gb";

/**
 * The number in the form Telnyx wants to dial, or null if we cannot build one.
 *
 * Toll-free is null on purpose: Singapore 1800 lines are generally not
 * reachable from outside the country, and offering a dial button that fails is
 * worse than offering none — the copy-to-clipboard button still works.
 */
export function e164(
  raw: string,
  defaultRegion?: CallRegion | null,
): string | null {
  const d = raw.replace(/\D/g, "");
  switch (classifyPhone(raw, defaultRegion)) {
    case "sg":
      return `+65${d.length === 8 ? d : d.slice(2)}`;
    case "us":
      // Ten digits national, eleven with the country code already on it.
      return `+1${d.length === 11 && d.startsWith("1") ? d.slice(1) : d}`;
    case "gb": {
      const national = gbNational(d) ?? gbLocal(d);
      return national ? `+44${national}` : null;
    }
    default:
      return null;
  }
}

/**
 * Our caller ID for that country, or null when none is configured.
 *
 * Read per call rather than at module scope, like `google.ts` does with its
 * client config: a missing variable should make one button say why it is
 * disabled, not stop the process booting.
 *
 * There is deliberately no fallback to another country's number. A UK business
 * seeing a US caller ID answers far less often, and that halves a connect rate
 * with nothing on any screen to point at.
 */
export type DidMap = Partial<Record<DialCountry, string>>;

/**
 * The number this caller rings from.
 *
 * One number, assigned to them on the Team screen. This started with a second
 * layer of a number per market that a person with none fell back to, which
 * meant the caller ID on any given call could come from two places and neither
 * was obvious from the screen. A caller either has a number or does not, and
 * "not yet" is a clearer thing to show than a shared one they did not choose.
 *
 * Returned as a map keyed by the lead's country so `toLead` stays unchanged,
 * but every entry is the same number: it is theirs, and every lead they can
 * see is in their own market anyway.
 */
export const getDids = cache(async (): Promise<DidMap> => {
  const me = await getCurrentUser();
  if (!me) return {};
  const [row] = (await db.execute(sql`
    select call_region, telnyx_did from app_user where id = ${me.id}
  `)) as { call_region: DialCountry | null; telnyx_did: string | null }[];
  const did = row?.telnyx_did?.trim();
  if (!did) return {};
  return { sg: did, us: did, gb: did };
});

export function didFor(
  country: DialCountry | null,
  dids: DidMap,
): string | null {
  return country ? (dids[country] ?? null) : null;
}

/** The country whose DID should be presented when ringing this number. */
export function dialCountry(raw: string): DialCountry | null {
  const kind = classifyPhone(raw);
  return kind === "sg" || kind === "us" || kind === "gb" ? kind : null;
}

/**
 * The market a caller works, set per person on the Team screen.
 *
 * Derived from the lead once, which meant the library had to carry every
 * region at once and labelled, so nobody could tell which was theirs. A caller
 * works one market all day.
 */
export type CallRegion = "sg" | "us" | "gb";

/**
 * Which set of documents a market reads.
 *
 * There are two scripts, and what separates them is WhatsApp rather than
 * geography: the `sg` set pitches it, the `us` set does not. The UK is its own
 * market with no script of its own and reads the WhatsApp one, because UK
 * businesses do run on it — it was pointed at the US set on the assumption
 * they did not, which was wrong.
 *
 * Kept as a mapping rather than storing the script's name against a caller, so
 * "who works the UK" stays answerable and giving the UK a script of its own
 * later is one line here instead of a data migration.
 */
export type SopRegion = "sg" | "us";

export const sopRegionFor = (region: CallRegion | null): SopRegion | null =>
  region === "sg" || region === "gb" ? "sg" : region === "us" ? "us" : null;
