import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PICKUP, STATS_TZ, todayInStatsTz } from "@/lib/call-stats";
import {
  MEETING_CENTS,
  pickupBonusCents,
} from "@/lib/payroll-rates";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/**
 * The rates, re-exported from the database-free module they live in so that
 * `from "@/lib/payroll"` works everywhere on the server and there is still
 * only one place to change one. Same arrangement as `lib/calls.ts` and the
 * phone rules in `lib/phone.ts`.
 */
export {
  MEETING_CENTS,
  PICKUPS_PER_BONUS,
  PICKUP_BONUS_CENTS,
  formatMoney,
  pickupBonusCents,
  pickupsTowardNext,
} from "@/lib/payroll-rates";

/**
 * Monday (Eastern) of the week a payout falls in, as YYYY-MM-DD.
 *
 * Stamped onto the payout row so the history groups by week in the database
 * rather than being re-derived on every read — the reporting zone has moved
 * once already, from Singapore to New York, and that must not silently
 * reshuffle which week an old payment belongs to.
 *
 * Built by string arithmetic through an explicit `Z`, the same pattern
 * `call-stats/page.tsx` uses to step back a day: a calendar date has no zone,
 * and `new Date("2026-08-27")` is UTC midnight, which reads as the day before
 * anywhere west of Greenwich.
 */
export function payWeekStart(today = todayInStatsTz()): string {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Dates on this screen, rendered in the reporting zone.
 *
 * Pinned to `STATS_TZ` and `en-GB` rather than the reader's own, for the reason
 * `leads-grid.tsx` pins its own: the droplet runs UTC and the team's browsers
 * do not, so an unpinned format renders one string on the server and another on
 * hydration. Everything here is formatted server-side and passed down as text,
 * so a client component never has to know the zone at all.
 */
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: STATS_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const formatPayDay = (iso: string) => dayFormat.format(new Date(iso));

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-24" → "24 Aug 2026", from the string's own parts. A calendar date
 *  has no zone, so it is formatted as text and never becomes a `Date`. */
export function formatPayWeek(weekStart: string): string {
  const [y, m, d] = weekStart.split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month} ${y}` : weekStart;
}

export type PayrollRow = {
  userId: number;
  name: string;
  active: boolean;
  /** When this person's counter last reset — their last payout, or the day
   *  the account was made. What the pickup figure counts from. */
  periodStart: string;
  /** Null when they have never been paid. */
  lastPaidAt: string | null;
  pickups: number;
  pickupBonusCents: number;
  meetings: number;
  meetingCommissionCents: number;
  totalCents: number;
};

/**
 * What each caller is owed right now.
 *
 * Two different shapes of question, deliberately answered two different ways:
 *
 *  - **Pickups** are counted since the person's last payout, because that is
 *    the only thing that resets the counter. Comparing timestamps rather than
 *    bucketing calendar days also keeps the reporting timezone out of a
 *    payment calculation entirely.
 *  - **Meetings** are every attendance not yet claimed by a payout, with no
 *    date filter at all. An attendance confirmed late — a fortnight-old
 *    meeting marked showed-up after that period was paid — would fall through
 *    a date window and never be paid. It cannot fall through this.
 *
 * Written as raw SQL with the identifiers spelled out and qualified, like
 * `call-stats.ts`. Not the query builder: Drizzle renders an interpolated
 * column unqualified inside a subquery, so `${appUser.id}` comes out as a bare
 * `"id"` and binds to whatever table the subquery is selecting from — the
 * silent-wrong-answer trap AGENTS.md documents, and the last thing this file
 * can afford.
 *
 * Only callers appear. Founders are the ones paying, and the Scoreboard
 * already excludes them from the floor's numbers for the same reason.
 * Deactivated callers are dropped by `getPayroll` below only once they are
 * owed nothing — switching someone off must not hide an unpaid balance.
 */
export async function getPayrollRows(): Promise<PayrollRow[]> {
  const rows = (await db.execute(sql`
    select u.id, u.name, u.active,
      coalesce(p.paid_at, u.created_at) as period_start,
      p.paid_at as last_paid_at,
      (
        select count(*) from "call" c
        where c.user_id = u.id
          and c.outcome in ${PICKUP}
          and c.called_at > coalesce(p.paid_at, u.created_at)
      ) as pickups,
      (
        select count(*)
        from call_demo_attendance a
        join "call" ac on ac.id = a.call_id
        where ac.user_id = u.id
          and a.showed_up
          and a.payout_id is null
      ) as meetings
    from app_user u
    left join lateral (
      select paid_at from payout
      where payout.user_id = u.id
      order by paid_at desc
      limit 1
    ) p on true
    where u.role = 'caller'
    order by u.name asc
  `)) as Row[];

  return rows.map((r) => {
    const pickups = n(r.pickups);
    const meetings = n(r.meetings);
    const bonus = pickupBonusCents(pickups);
    const commission = meetings * MEETING_CENTS;
    return {
      userId: n(r.id),
      name: String(r.name),
      active: Boolean(r.active),
      periodStart: new Date(r.period_start as string).toISOString(),
      lastPaidAt: r.last_paid_at
        ? new Date(r.last_paid_at as string).toISOString()
        : null,
      pickups,
      pickupBonusCents: bonus,
      meetings,
      meetingCommissionCents: commission,
      totalCents: bonus + commission,
    };
  });
}

/** Active callers, plus any deactivated one still owed money — switching
 *  someone off is not a way to stop owing them. */
export async function getPayroll(): Promise<PayrollRow[]> {
  const rows = await getPayrollRows();
  return rows.filter((r) => r.active || r.totalCents > 0);
}

export type DemoToConfirm = {
  callId: number;
  leadId: number;
  company: string;
  listName: string;
  /** Null for the calls logged before staff accounts existed. */
  callerName: string | null;
  bookedAt: string;
  notes: string | null;
  /** Null when nobody has answered yet. */
  showedUp: boolean | null;
};

/**
 * How long a no-show stays on the list after it has been answered.
 *
 * A no-show earns nothing, so no payout ever claims it and nothing would
 * otherwise take it off a list that is meant to be a worklist — a year in,
 * "Meetings to confirm" would be mostly an archive of meetings nobody is
 * waiting on. It stays a fortnight so a mis-tap is still fixable, which is
 * about the span the SOP's two rebooking attempts play out over.
 */
const NO_SHOW_CORRECTION_DAYS = 14;

/**
 * Booked demos still awaiting an answer, plus answered ones still in play.
 *
 * Three states belong here and each leaves for a different reason:
 *  - unanswered: always listed, however old. This is the one that costs
 *    somebody money if it is forgotten.
 *  - showed up, unpaid: listed until a payout claims it, after which the API
 *    refuses to change it anyway — that money has gone out.
 *  - no-show: listed for `NO_SHOW_CORRECTION_DAYS`, then gone. Nothing else
 *    would ever remove it.
 *
 * Ordered oldest first. This is a worklist, and the meeting that happened three
 * weeks ago is the one at risk of never being asked about.
 */
export async function getDemosToConfirm(): Promise<DemoToConfirm[]> {
  const rows = (await db.execute(sql`
    select c.id as call_id, c.called_at, c.notes,
      l.id as lead_id, l.company, l.name as lead_name,
      cl.name as list_name,
      u.name as caller_name,
      a.showed_up
    from "call" c
    join call_lead l on l.id = c.call_lead_id
    join call_list cl on cl.id = l.call_list_id
    left join app_user u on u.id = c.user_id
    left join call_demo_attendance a on a.call_id = c.id
    where c.outcome = 'demo_booked'
      and (
        a.id is null
        or (a.showed_up and a.payout_id is null)
        or (
          not a.showed_up
          and a.marked_at > now() - make_interval(days => ${NO_SHOW_CORRECTION_DAYS})
        )
      )
    order by c.called_at asc
  `)) as Row[];

  return rows.map((r) => ({
    callId: n(r.call_id),
    leadId: n(r.lead_id),
    // Directory scrapes file the business in `company`; a contact list may
    // only have a person. Falling back keeps the row identifiable either way.
    company:
      (r.company as string | null) ||
      (r.lead_name as string | null) ||
      "Unnamed business",
    listName: String(r.list_name),
    callerName: (r.caller_name as string | null) ?? null,
    bookedAt: new Date(r.called_at as string).toISOString(),
    notes: (r.notes as string | null) ?? null,
    showedUp: r.showed_up === null ? null : Boolean(r.showed_up),
  }));
}

export type PayoutRecord = {
  id: number;
  userId: number;
  name: string;
  paidAt: string;
  weekStart: string;
  periodStart: string;
  periodEnd: string;
  pickups: number;
  pickupBonusCents: number;
  meetings: number;
  meetingCommissionCents: number;
  totalCents: number;
};

/**
 * Every payout, newest first, with the person's name joined on.
 *
 * The amounts come off the payout row rather than being recomputed — that is
 * the whole point of storing them. A call edited or a lead deleted since
 * cannot move a number on this list.
 */
export async function getPayoutHistory(limit = 200): Promise<PayoutRecord[]> {
  const rows = (await db.execute(sql`
    select p.id, p.user_id, u.name, p.paid_at, p.week_start,
      p.period_start, p.period_end,
      p.pickups, p.pickup_bonus_cents,
      p.meetings, p.meeting_commission_cents, p.total_cents
    from payout p
    join app_user u on u.id = p.user_id
    order by p.paid_at desc
    limit ${limit}
  `)) as Row[];

  return rows.map((r) => ({
    id: n(r.id),
    userId: n(r.user_id),
    name: String(r.name),
    paidAt: new Date(r.paid_at as string).toISOString(),
    // Already a YYYY-MM-DD calendar date; never turned into a `Date`, which
    // would resolve at UTC midnight and render as the day before out west.
    weekStart: String(r.week_start).slice(0, 10),
    periodStart: new Date(r.period_start as string).toISOString(),
    periodEnd: new Date(r.period_end as string).toISOString(),
    pickups: n(r.pickups),
    pickupBonusCents: n(r.pickup_bonus_cents),
    meetings: n(r.meetings),
    meetingCommissionCents: n(r.meeting_commission_cents),
    totalCents: n(r.total_cents),
  }));
}

/** Payouts grouped under the week they were paid in, newest week first. The
 *  grouping key is the stored `week_start`, so it cannot shift if the
 *  reporting zone moves. */
export function byWeek(payouts: PayoutRecord[]) {
  const weeks = new Map<string, PayoutRecord[]>();
  for (const p of payouts) {
    const list = weeks.get(p.weekStart);
    if (list) list.push(p);
    else weeks.set(p.weekStart, [p]);
  }
  return [...weeks.entries()].map(([weekStart, rows]) => ({
    weekStart,
    rows,
    totalCents: rows.reduce((sum, r) => sum + r.totalCents, 0),
  }));
}
