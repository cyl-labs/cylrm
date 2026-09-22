import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { leadZone, withinLeadHours } from "@/lib/calls";
import { dncBlockReason } from "@/lib/dnc";
import { dialCountry } from "@/lib/phone";
import type { CurrentUser } from "@/lib/session";

/**
 * Calls that came in.
 *
 * The mirror of the callbacks diary, and read the same way: opened at the
 * start of a shift, worked top to bottom. What it answers is the thing the
 * Call CRM could not answer at all until inbound existed — somebody rang us
 * and nobody picked up.
 *
 * Rows are written by the Telnyx webhook, so a call that rang out while the
 * CRM was closed is here too. That is the whole reason this is not derived
 * from anything the browser saw.
 */

export type InboundCall = {
  id: number;
  from: string;
  /** Which of our numbers they rang. */
  to: string;
  /** How many times this number rang in the period, rolled into this row. One
   *  for an ordinary missed call; more when their phone system redialled
   *  against a browser that was not registered. */
  rings: number;
  /** When the first of those rings came in. Equal to `at` when there was only
   *  one. */
  firstAt: string;
  /** Whose number it was. Null when it belongs to nobody, which only an admin
   *  ever sees and which means a number is routed somewhere unowned. */
  forName: string | null;
  at: string;
  /** Null means nobody picked up. */
  answeredAt: string | null;
  /** Seconds on the call, when it was answered. */
  seconds: number | null;
  handledAt: string | null;
  handledBy: string | null;

  /** The lead this number belongs to, when we have one. */
  leadId: number | null;
  company: string | null;
  leadName: string | null;
  listName: string | null;
  /** The niche it sits in, so "Open lead" can land on the dial card for it
   *  rather than on the spreadsheet. Null exactly when `leadId` is. */
  listId: number | null;
  /** Tries already logged against the lead, so the outcome menu can say which
   *  attempt this one is — the same thing the callbacks diary shows. */
  attempts: number;
  /** Why this number may not be rung, or null — the same block the dialler
   *  and the callbacks diary apply, so a screening result cannot be walked
   *  past just because the prospect rang first. */
  dncBlock: string | null;
  /** The ring back can wait until their morning: see `CAN_WAIT`. Only means
   *  anything on a missed call still owed one. */
  canWait: boolean;
  /** Their clock at the moment the page was drawn, like "3:35am". Null when
   *  their zone is unknown, which is also exactly when `canWait` is false. */
  theirNow: string | null;
  /**
   * The zone itself, not just a clock rendered from it.
   *
   * `theirNow` is a formatted string and cannot be computed with: setting a
   * callback from this row means turning a typed wall clock into an instant in
   * the prospect's zone, and "3:35am" will not do it. The query has always
   * joined `leadZone` and read `z.tz` — it simply never selected it.
   */
  tz: string | null;
};

/** A caller sees calls to their own number; an admin sees the lot, including
 *  the ones belonging to nobody. Deliberately by the number that was rung
 *  rather than by any list ownership: an inbound call is addressed to a
 *  person, not to a niche. */
const scoped = (me: CurrentUser | null) =>
  me?.role === "admin" ? sql`` : sql`and ic.user_id = ${me?.id ?? -1}`;

/**
 * Narrow an admin's view to the calls that rang their own number.
 *
 * Asked for on 2026-09-20: "separate founder missed calls from normal ones, i
 * want to know who called me specifically". A founder sees the whole floor's
 * inbound by design, which is right for making sure nothing is dropped and
 * useless for the question "did somebody ring *me* back". The rows have always
 * carried whose number it was — this is the filter that was missing.
 *
 * On top of `scoped`, never instead of it: a caller is already narrowed to
 * their own number and this adds nothing for them.
 */
const minedTo = (me: CurrentUser | null, mineOnly: boolean) =>
  mineOnly && me ? sql`and ic.user_id = ${me.id}` : sql``;

const KEEP_DAYS = 30;

/** How old a missed call has to be before it may wait for their morning. */
export const MISSED_CALL_FRESH_MINUTES = 60;

/**
 * A missed call whose ring back can wait until business hours where they are.
 *
 * Missed calls are the first stage of the work order and block a caller's
 * queue until cleared, so a call from a business that had just shut pushed
 * the caller to clear it in the middle of that business's night. On 2026-09-15
 * a Hawaii business rang Raffy back just after 4pm and 5pm their time; he
 * cleared both at 3:23 and 3:35am their time, because his queue was shut until
 * he did.
 *
 * Waits only when **both** hold. It came in more than an hour ago: somebody who
 * rang within the hour is plainly awake whatever their clock says, and is the
 * warmest call of the day, so that one still goes first (the founders' rule).
 * And the business is closed where they are now, by the same `withinLeadHours`
 * the dial queue filters on (their own hours where known, 9 to 6 otherwise). **An unknown zone never waits**: a warm lead we
 * cannot place is not a reason to delay it.
 *
 * It stays on the Missed calls screen, labelled. It leaves the badge and the
 * work-order gate, which both read `countMissedCalls`, and comes back to them
 * the moment they open. Expects the lead as `l` and `leadZone` joined, giving
 * `z`.
 */
const CAN_WAIT = sql`(
  ic.started_at < now() - ${`${MISSED_CALL_FRESH_MINUTES} minutes`}::interval
  and z.tz is not null
  and not ${withinLeadHours(sql`now()`)}
)`;

/**
 * Somebody has already rung this lead back since they called in.
 *
 * Clearing a missed call was only ever possible through the row's own button
 * (`PATCH /api/inbound-calls/[id]`), which writes the `call` row and stamps
 * `handled_at` in one transaction. Ring the same person back from anywhere
 * else — open the lead, dial, log the outcome — and the work is done but the
 * inbound row never hears about it, so it sits on the screen for ever.
 *
 * Reported by Mico on 2026-09-16 and verified in the data: five rows with
 * `handled_at` and `handled_by` both null, each carrying calls logged after
 * the prospect rang, at least one of them genuinely dialled. Every row cleared
 * the intended way carries a `handled_by` name, which is what told the two
 * apart.
 *
 * Derived rather than stored, so it needs no migration and no backfill: the
 * rows already in that state clear themselves the moment this ships, and it
 * cannot drift out of step the way a second `handled_at` writer would.
 *
 * A row matching no lead never satisfies this — `ic.call_lead_id` is null, the
 * `exists` is false, and it keeps its "Mark as rung back". That is deliberate:
 * an unmatched number is the likeliest to be a genuine new enquiry.
 */
const RUNG_BACK_SINCE = sql`exists (
  select 1 from call c
  where c.call_lead_id = ic.call_lead_id
    and c.called_at > ic.started_at
)`;

/**
 * How long a gap has to be before a redial counts as trying again.
 *
 * The bursts measured on prod are seconds apart — seventeen rings inside one
 * minute — so anything on this scale collapses them. Fifteen minutes rather
 * than an hour because somebody who rings, gives up, and tries again after
 * lunch has genuinely tried twice, and the second attempt is worth its own
 * row.
 */
const BURST_MINUTES = 15;

/**
 * One row per attempt to reach us, not one per ring.
 *
 * A prospect ringing a browser that is not registered gets refused by Telnyx
 * in under a second, and their phone system simply redials — so one person
 * trying to reach us once arrives here as a burst of legs with distinct
 * session ids. Measured on 2026-09-18: 163 inbound legs over seven days, only
 * 13 of them answered, **80 shorter than two seconds**, and one number ringing
 * seventeen times inside a single minute. The screen listed every leg, so the
 * same business appeared five times in a row and the badge counted seventeen
 * calls owed where one person had tried once.
 *
 * Gaps and islands rather than one bucket per number: rings closer together
 * than `BURST_MINUTES` are one attempt, and a longer gap starts a new one, so
 * ringing again tomorrow is a second row rather than a bigger number on the
 * first. Grouped by the number *and* whose line it rang, because that pair is
 * what a caller owes — the same business reaching two callers is two ring
 * backs, and the row says whose it is.
 *
 * The newest leg of a burst represents it and carries how many there were, so
 * nothing is hidden: "rang 17 times" is the useful version of seventeen rows.
 *
 * Done before the lead join on purpose. Joining first and de-duplicating after
 * would run the window functions over the joined set, where `count(*)` counts
 * join output rather than rings.
 */
const ROLLED_UP = (
  me: CurrentUser | null,
  missedOnly: boolean,
  mineOnly: boolean,
) => sql`
  select b.*,
    count(*) over w as rings,
    min(b.started_at) over w as first_at,
    row_number() over (
      partition by b.from_number, b.user_id, b.burst
      order by b.started_at desc, b.id desc
    ) as rn
  from (
    select m.*,
      -- A running count of the gaps seen so far is the burst's number: it only
      -- goes up when a ring lands more than BURST_MINUTES after the one before
      -- it, so every ring inside one flurry shares a value.
      sum(m.gap) over (
        partition by m.from_number, m.user_id
        order by m.started_at, m.id
        rows unbounded preceding
      ) as burst
    from (
      select ic.*,
        case
          when lag(ic.started_at) over (
            partition by ic.from_number, ic.user_id
            order by ic.started_at, ic.id
          ) > ic.started_at - make_interval(mins => ${BURST_MINUTES}::int)
          then 0
          else 1
        end as gap
      from inbound_call ic
      where ic.started_at > now() - ${`${KEEP_DAYS} days`}::interval
        ${missedOnly
          ? sql`and ic.answered_at is null and ic.handled_at is null
                and not ${RUNG_BACK_SINCE}`
          : sql``}
        ${scoped(me)}
        ${minedTo(me, mineOnly)}
    ) m
  ) b
  window w as (partition by b.from_number, b.user_id, b.burst)
`;

export async function getInboundCalls(
  me: CurrentUser | null,
  {
    missedOnly = false,
    mineOnly = false,
  }: { missedOnly?: boolean; mineOnly?: boolean } = {},
): Promise<InboundCall[]> {
  const rows = (await db.execute(sql`
    select ic.id, ic.from_number, ic.to_number, ic.started_at, ic.answered_at,
      ic.ended_at, ic.handled_at, ic.rings, ic.first_at,
      u.name as for_name,
      h.name as handled_by,
      l.id as lead_id, l.company, l.name as lead_name,
      l.dnc_status, l.dnc_checked_at,
      cl.name as list_name, cl.id as list_id,
      (select count(*) from call c where c.call_lead_id = l.id) as attempts,
      ${CAN_WAIT} as can_wait,
      -- Formatted here for the reason Stats formats "their time" in SQL: the
      -- zone varies per row, and a clock built in the browser renders one
      -- string on the server and another on hydration.
      to_char(now() at time zone z.tz, 'FMHH12:MIam') as their_now,
      -- The zone itself as well as the clock built from it: setting a callback
      -- from this row has to turn a typed wall time into an instant where the
      -- prospect is, and a formatted "3:35am" cannot be computed with.
      z.tz
    from (${ROLLED_UP(me, missedOnly, mineOnly)}) ic
    left join app_user u on u.id = ic.user_id
    left join app_user h on h.id = ic.handled_by
    left join call_lead l on l.id = ic.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    ${leadZone}
    where ic.rn = 1
    order by ic.started_at desc
    limit 300
  `)) as Record<string, unknown>[];

  return rows.map((r) => {
    const answeredAt = r.answered_at ? new Date(r.answered_at as string) : null;
    const endedAt = r.ended_at ? new Date(r.ended_at as string) : null;
    const phone = String(r.from_number);
    return {
      id: Number(r.id),
      from: phone,
      to: String(r.to_number),
      rings: Number(r.rings ?? 1),
      firstAt: new Date((r.first_at ?? r.started_at) as string).toISOString(),
      forName: (r.for_name as string | null) ?? null,
      at: new Date(r.started_at as string).toISOString(),
      answeredAt: answeredAt?.toISOString() ?? null,
      seconds:
        answeredAt && endedAt
          ? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000))
          : null,
      handledAt: r.handled_at
        ? new Date(r.handled_at as string).toISOString()
        : null,
      handledBy: (r.handled_by as string | null) ?? null,
      leadId: r.lead_id === null ? null : Number(r.lead_id),
      company: (r.company as string | null) ?? null,
      leadName: (r.lead_name as string | null) ?? null,
      listName: (r.list_name as string | null) ?? null,
      listId: r.list_id === null ? null : Number(r.list_id),
      attempts: Number(r.attempts ?? 0),
      dncBlock: dncBlockReason(
        {
          dncStatus: (r.dnc_status as "clean" | "listed" | null) ?? null,
          dncCheckedAt: r.dnc_checked_at
            ? new Date(r.dnc_checked_at as string).toISOString()
            : null,
        },
        dialCountry(phone),
      ),
      canWait: r.can_wait === true,
      theirNow: (r.their_now as string | null) ?? null,
      tz: (r.tz as string | null) ?? null,
    };
  });
}

/**
 * How many missed calls are owed a ring back **now**.
 *
 * Not every unhandled one: a call that can wait until their morning
 * (`CAN_WAIT`) is left out, so the sidebar badge and the work-order gate — both
 * of which read this — say "act now" and agree with each other. The Missed
 * calls screen still lists the ones that can wait.
 *
 * **Only the reader's own number**, which for a caller is everything they can
 * see anyway and for a founder is the change: the badge used to count the
 * whole floor's, so it was never zero and never meant "something new for me".
 * Asked for on 2026-09-22 — "I want the notification to be for me only so I
 * know something is new". The Missed calls screen keeps its everyone view and
 * the badge links to the matching `?who=mine` one, so the number you tap is
 * the number you land on.
 *
 * `cache()`d for the reason `countCallbacksDue` and `countUnreadReplies` are:
 * the sidebar and `PageShell` both ask while rendering one page.
 */
export const countMissedCalls = cache(async function countMissedCalls(
  me: CurrentUser | null,
): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as n
    from (${ROLLED_UP(me, true, true)}) ic
    left join call_lead l on l.id = ic.call_lead_id
    ${leadZone}
    -- One per number owed a ring back, the same roll-up the list shows: a
    -- badge that counted legs said seventeen where one person had rung once.
    where ic.rn = 1
      and not ${CAN_WAIT}
  `)) as { n: number }[];
  return row?.n ?? 0;
});
