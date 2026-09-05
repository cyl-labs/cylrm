import { cache } from "react";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { dncBlockReason } from "@/lib/dnc";
import { getCurrentUser } from "@/lib/session";
import { dialCountry, e164 } from "@/lib/phone";
import { STATE_TZ } from "@/lib/us-states";
import {
  LEAD_HOURS_END,
  LEAD_HOURS_START,
} from "@/lib/call-hours";
import { listAccountNumbers } from "@/lib/telnyx";
import type { CallRegion, DialCountry } from "@/lib/phone";

/**
 * The phone rules now live in `lib/phone.ts` and are re-exported here.
 *
 * They are pure string functions with no database in them, and the keypad is a
 * client component: importing them from this module pulled the Postgres client
 * into the browser bundle, which is the same wall `components/calls/outcome.ts`
 * was built to get around. Re-exported rather than moved outright so every
 * existing `from "@/lib/calls"` keeps working — one place to import from, and
 * no second copy of the rules to drift.
 */
export { classifyPhone, dialCountry, e164 } from "@/lib/phone";
export type { CallRegion, DialCountry } from "@/lib/phone";
export {
  LEAD_HOURS_END,
  LEAD_HOURS_LABEL,
  LEAD_HOURS_START,
} from "@/lib/call-hours";

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

/**
 * Which clock the lead is on, and therefore what time it is where they are.
 *
 * A US area code decides it — the lists are national, "Movers" alone spans 152
 * of them, and roughly a third of the US leads are outside business hours at
 * any given moment. The callers are overseas, so their own clock says nothing
 * about whether a number can be rung.
 *
 * Resolved in SQL rather than after the rows come back, because the queue
 * selects with a LIMIT: filtering in JavaScript would hand out short pages and
 * counts that do not match them.
 *
 * Singapore and the UK are one zone each and need no table. A number with no
 * zone — toll-free, or an area code not in `us_area_code` — comes back null
 * rather than being guessed at, and is excluded when the caller asks for
 * leads they can ring now. Expects `call_lead` aliased as `l`.
 */
const STATE_TZ_SQL = sql.join(
  Object.entries(STATE_TZ).map(
    ([name, tz]) => sql`when ${name} then ${tz}`,
  ),
  sql` `,
);

export const leadZone = sql`
  left join us_area_code ac
    on l.phone_key ~ '^1[0-9]{10}$'
   and ac.area_code = substr(l.phone_key, 2, 3)
  cross join lateral (
    select coalesce(
      -- The address first, the number second. An area code says where a
      -- number was issued and a business that moves states keeps its mobile,
      -- so on the leads where the two disagree this is the half that is right.
      -- Only unambiguous states are in the map — inside the correct state an
      -- area code is the narrower answer, so the state may only overrule it
      -- where the state has one zone and cannot be narrowed. See us-states.ts.
      case when l.phone_key ~ '^1[0-9]{10}$'
        then case lower(trim(coalesce(l.source_fields->>'state', '')))
          ${STATE_TZ_SQL}
        end
      end,
      ac.tz,
      case
        when l.phone_key ~ '^65[0-9]{8}$' then 'Asia/Singapore'
        when l.phone_key ~ '^44' then 'Europe/London'
      end
    ) as tz
  ) z
`;

/**
 * Business hours where the lead is: 9am to 5pm, their time.
 *
 * The whole point of the feature — a caller starting at 10pm Singapore can
 * ring the east coast and must not be handed Honolulu, where it is half past
 * three in the morning.
 */
/**
 * Was it business hours where the lead is, at some instant?
 *
 * Takes the instant so one rule serves both questions asked of it: the queue
 * asks about `now()`, and Stats asks about `called_at` after the fact. Two
 * copies of "9 to 5 their time" would be two answers to the same question, and
 * the one on the report had better be the one the dialler filtered by.
 *
 * A null zone is never in hours. Toll-free belongs to no place and an unknown
 * area code is not worth guessing at, so those are excluded here and reported
 * separately rather than being flagged as an out-of-hours call nobody made.
 *
 * Expects the `leadZone` lateral aliased as `z`.
 */
export const withinLeadHours = (at: SQL) => sql`(
  z.tz is not null
  and (${at} at time zone z.tz)::time >= time ${sql.raw(`'${LEAD_HOURS_START}'`)}
  and (${at} at time zone z.tz)::time < time ${sql.raw(`'${LEAD_HOURS_END}'`)}
)`;

const CALLABLE_NOW = withinLeadHours(sql`now()`);

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
  /**
   * Where the business is, as the scrape recorded it.
   *
   * The caller needs this so they do not have to open with "where are you
   * based?", which sounds like what it is — someone reading a list. Present on
   * roughly four US leads in five and null on the rest, and **never inferred
   * from the area code**: a number says where it was issued, not where the
   * business is, and the scrape that carries these also carries a
   * `flag_area_state_mismatch` on 802 rows precisely because the two disagree.
   * A confidently wrong "so you're in Texas?" is worse than not mentioning it,
   * which is the same rule `tz` follows for an unmapped area code.
   *
   * **US numbers only.** Singapore is one city on one clock and the UK is one
   * zone, so a place there is a line of noise repeated on every card rather
   * than something a caller acts on. The filter is in `leadColumns`, so every
   * screen gets the same answer.
   */
  city: string | null;
  state: string | null;
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
  /**
   * The IANA zone the lead is in, from their area code.
   *
   * Null when it cannot be known — a toll-free number belongs to no place, and
   * an area code we have no row for is not worth guessing at. The screens show
   * nothing rather than a wrong clock, and "leads I can ring now" leaves those
   * out.
   */
  tz: string | null;
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
  -- Where the business actually is, straight off the scrape. Read from
  -- source_fields rather than promoted to columns because nothing queries or
  -- sorts on it — it is one line of text on a card — and a jsonb read costs
  -- nothing next to the joins already here. nullif() because the scrapes write
  -- an empty string as often as they omit the key, and "" is not a place.
  --
  -- US numbers only, and that is the whole point rather than a limitation:
  -- Singapore is one city on one clock, so naming it on every card is a line
  -- of noise on every card. The UK is excluded on the same reasoning — one
  -- zone, and nobody is deciding when to ring by it. Widening this is one
  -- regex, but it should be earned by a market where the answer varies.
  case when l.phone_key ~ '^1[0-9]{10}$'
    then nullif(l.source_fields->>'city', '') end as city,
  case when l.phone_key ~ '^1[0-9]{10}$'
    then nullif(l.source_fields->>'state', '') end as state,
  l.dnc_status, l.dnc_checked_at,
  lc.outcome as last_outcome, lc.called_at as last_called_at,
  lc.callback_at, lc.notes as last_notes, lc.by_name as last_called_by,
  lr.recording_id, lr.duration_ms as recording_ms,
  (select count(*) from call c where c.call_lead_id = l.id) as attempts,
  z.tz
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
    city: (r.city as string | null) ?? null,
    state: (r.state as string | null) ?? null,
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
    tz: (r.tz as string | null) ?? null,
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
    ${leadZone}
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
    ${leadZone}
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

/**
 * How many callbacks this person owes by the end of today — the daily digest.
 *
 * Deliberately a wider question than `countCallbacksDue`, which drives the
 * sidebar badge and means "act on this now". At eight in the morning almost
 * nothing is due yet, so a badge-shaped number would report zero and tell a
 * caller their day is empty. This counts everything promised for today, plus
 * anything already run past, which is what a morning briefing is for.
 *
 * The two are allowed to differ because they answer different questions, and
 * the notification says "due today" where the badge says nothing — but keep
 * that wording honest if either changes.
 */
export async function countCallbacksDueToday(
  ownerId: number | undefined,
  tz: string,
): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(l.id) as n
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    ${latestCall}
    where l.duplicate_of_lead_id is null
      ${ownedBy(ownerId)}
      and lc.outcome = 'callback'
      and (
        lc.callback_at is null
        -- Local midnight tonight, turned back into an instant. The literal 1
        -- rather than a parameter is on purpose: a bare placeholder makes
        -- adding to a date ambiguous to Postgres.
        or lc.callback_at
             < (((now() at time zone ${tz})::date + 1)::timestamp at time zone ${tz})
      )
  `)) as Row[];
  return n(row?.n);
}

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
    ${leadZone}
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
/**
 * Which leads a dialling tab holds.
 *
 * Extracted so `countQueueCallableNow` counts exactly the rows `getCallQueue`
 * would return. Two copies of this drifting apart would put a number on the
 * screen that the queue underneath it disagrees with, which is worse than no
 * number at all.
 */
function queueWhere(filter: CallQueueFilter) {
  return filter === "queue"
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
}

/**
 * How big this tab is, and how much of it can be rung right now.
 *
 * Both halves in one query, because the screen has to show both. Turning the
 * filter on shipped changing nothing but the button and a small badge — the
 * four summary tiles are list-wide by design — so it read as broken, and on a
 * list where every lead happens to be callable (both UK niches, at 2pm London)
 * literally nothing moved.
 *
 * Giving only the callable half was the second mistake: "135 of these can be
 * rung right now" above a queue of 194 reads as though 135 are being shown.
 * Both numbers, always, removes the ambiguity.
 *
 * Shares `queueWhere` with `getCallQueue` rather than restating the tab's
 * filter: a count that disagrees with the queue printed under it is worse than
 * no count.
 */
export async function countQueueSplit(
  callListId: number,
  filter: CallQueueFilter = "queue",
): Promise<{ total: number; callableNow: number }> {
  const [row] = (await db.execute(sql`
    select count(l.id) as total,
      count(l.id) filter (where ${CALLABLE_NOW}) as callable_now
    from call_lead l
    ${latestCall}
    ${leadZone}
    where l.call_list_id = ${callListId}
      and l.duplicate_of_lead_id is null
      ${queueWhere(filter)}
  `)) as Row[];
  return { total: n(row?.total), callableNow: n(row?.callable_now) };
}

/** Ceiling on one dialling view. Every lead below the current card is listed,
 *  so this bounds the page as well as the query; the screen says when it
 *  bites rather than calling a partial list "All". */
export const CALL_QUEUE_LIMIT = 500;

export async function getCallQueue(
  callListId: number,
  filter: CallQueueFilter = "queue",
  /**
   * Only hand out leads it is business hours for, where they are.
   *
   * The reason this exists: a caller starting at 10pm Singapore can ring the
   * east coast, where it is 10am, and must not be handed Honolulu at half past
   * three in the morning. Applied in the query rather than after it, because
   * of the LIMIT below — filtering the page after fetching it would return
   * five leads and call it a queue.
   */
  callableNow = false,
): Promise<QueueLead[]> {
  const where = queueWhere(filter);

  const rows = (await db.execute(sql`
    select ${leadColumns}
    from call_lead l
    ${latestCall}
    ${leadZone}
    where l.call_list_id = ${callListId}
      and l.duplicate_of_lead_id is null
      ${where}
      ${callableNow ? sql`and ${CALLABLE_NOW}` : sql``}
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
 * Every key one line could be stored under.
 *
 * `phoneKey` needs a market to read a number written without a country code,
 * and an inbound call arrives without one: the WebRTC SDK reports a caller as
 * "7346396427", dropping the "+1" Telnyx sent. Keyed as written that misses
 * "17346396427", so a prospect we have called before rings in as an unknown
 * number — which happened on the first real inbound call, to a lead sitting in
 * the caller's own niche.
 *
 * Rather than infer a market and risk the 650/65 collision `classifyPhone`
 * documents, this returns the small set of keys that are *the same line*
 * written differently. Adding or removing a NANP country code cannot turn one
 * number into another: "1" + ten digits is the international form of those ten
 * digits and nothing else.
 *
 * For matching only. `phoneKey` remains what a row is *stored* under, so
 * nothing here can create a second key for one lead.
 */
export function phoneKeyCandidates(raw: string): string[] {
  const key = phoneKey(raw);
  if (!key) return [];
  const out = new Set([key]);
  // The national form of a NANP number, and its international twin.
  if (key.length === 10) out.add(`1${key}`);
  if (key.length === 11 && key.startsWith("1")) out.add(key.slice(1));
  return [...out];
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

/**
 * The lines worth a button when adding somebody to a call.
 *
 * Two conditions, and both are load-bearing. A `label` is what makes a number
 * nameable — "pxn junk removal" is a demo line somebody rings on purpose,
 * where a bare number is not worth a row — and it is typed on Team, so a new
 * line needs no deploy. Being on nobody's `telnyx_did` is the other: a number
 * assigned to a caller is that person's caller ID, and dialling it rings a
 * colleague rather than anything a prospect wants to hear.
 *
 * `available` is deliberately not consulted. It governs the caller-ID picker
 * on Team, and a demo line taken *out* of that pool is exactly what belongs
 * here — filtering on it would hide the number the moment it was correctly
 * marked reserved.
 *
 * `cache()`d because the dialler and the Keypad both ask while rendering one
 * page, the same reason `countUnreadReplies` is.
 */
export const getSavedLines = cache(async function getSavedLines(): Promise<
  { phoneNumber: string; label: string }[]
> {
  const rows = (await db.execute(sql`
    select trim(phone_number) as phone_number, trim(label) as label
    from call_number
    where coalesce(trim(label), '') <> ''
      and trim(phone_number) not in (
        select trim(telnyx_did) from app_user
        where coalesce(trim(telnyx_did), '') <> ''
      )
    order by label
  `)) as { phone_number: string; label: string }[];
  return rows.map((r) => ({ phoneNumber: r.phone_number, label: r.label }));
});

/**
 * What the Keypad can offer somebody to dial without typing it.
 *
 * Two groups, gated separately because they answer different needs — see
 * `components/calls/number-book.tsx` for what each is for:
 *
 * - `labelled`, only for the founders' accounts. The same set the mid-call
 *   "Add call" list uses, deliberately: a line worth conferencing in is a line
 *   worth ringing on its own, and two lists that disagree are two lists to
 *   learn.
 * - `plain`, only for someone whose market is every market. These come from
 *   Telnyx rather than `call_number`, which holds a row only for a number that
 *   has been labelled or reserved — "absent means available" — so the numbers
 *   nobody has touched exist nowhere else. Best effort: no API key or an
 *   unreachable Telnyx means an empty group and a pad that behaves exactly as
 *   it did before, never an error on a screen someone is trying to ring from.
 *
 * A number assigned to a colleague is kept in the plain group rather than
 * filtered out of it, unlike `getSavedLines`. That exclusion is right for a
 * *destination* offered mid-call — you would be ringing a colleague instead of
 * a prospect — and wrong here, where checking one of your own numbers answers
 * is the point, and where filtering them could empty the list entirely. Whose
 * it is shows on the row instead.
 */
export const getKeypadLines = cache(async function getKeypadLines(opts: {
  labelled: boolean;
  plain: boolean;
}): Promise<
  {
    phoneNumber: string;
    label: string | null;
    holder: string | null;
    country: string | null;
  }[]
> {
  const labelled = opts.labelled ? await getSavedLines() : [];

  if (!opts.plain) {
    return labelled.map((l) => ({ ...l, holder: null, country: null }));
  }

  const noteRows = (await db.execute(sql`
    select trim(phone_number) as phone_number, trim(coalesce(label, '')) as label
    from call_number
  `)) as { phone_number: string; label: string }[];
  const labels = new Map(
    noteRows.filter((r) => r.label).map((r) => [r.phone_number, r.label]),
  );

  const holderRows = (await db.execute(sql`
    select trim(telnyx_did) as did, name
    from app_user
    where coalesce(trim(telnyx_did), '') <> ''
  `)) as { did: string; name: string }[];
  const holders = new Map(holderRows.map((r) => [r.did, r.name]));

  // The empty set is the reserved one, which only decides `available`, and
  // nothing here reads it: a number taken out of the caller-ID pool is still a
  // number you may want to ring. Same reasoning as `getSavedLines`.
  const account = await listAccountNumbers(new Set(), labels);

  const plain = account
    .filter((a) => !a.label)
    .map((a) => ({
      phoneNumber: a.phoneNumber,
      label: null,
      holder: holders.get(a.phoneNumber) ?? null,
      country: a.country,
    }))
    // By country then number, so the market being looked for is a block rather
    // than something to hunt down the list for.
    .sort(
      (a, b) =>
        (a.country ?? "").localeCompare(b.country ?? "") ||
        a.phoneNumber.localeCompare(b.phoneNumber),
    );

  return [
    ...labelled.map((l) => ({
      ...l,
      holder: null,
      // Read off the number rather than asked of Telnyx: these are already
      // known by name, and a country chip on a row that says "pxn junk
      // removal" is answering a question nobody asked.
      country: null,
    })),
    ...plain,
  ];
});
