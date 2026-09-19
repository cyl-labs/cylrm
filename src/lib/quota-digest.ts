import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSetting } from "@/db/schema";
import { WEEKLY_CALL_QUOTA } from "@/lib/call-quota";
import { getWeekProgress, quotaWeekStart } from "@/lib/call-stats";
import { STATS_TZ, statsZone } from "@/lib/stats-zones";
import { pushConfigured, pushToUser } from "@/lib/push";

/**
 * The Friday "who finished under 300" digest, to the founders.
 *
 * `WEEKLY_CALL_QUOTA` was read in exactly one place before this — the strip
 * `PageShell` draws — and that strip is `role === "caller"` only. So the number
 * the founders set was visible to everybody except them: knowing where the
 * floor stood meant opening Stats and reading it person by person, which is a
 * number nobody looks up. This is that answer arriving on its own.
 *
 * **Founders only.** A caller already has the bar in their header all week, and
 * a Friday notification telling somebody they missed a target they have been
 * watching since Monday is a telling-off, not information.
 *
 * One digest, not one per caller who missed — the callback digest's reasoning,
 * which holds harder here: somebody who gets four notifications about other
 * people's numbers turns notifications off, and takes the meeting reminders
 * with them.
 */

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/**
 * ISO weekday order, so a stored 1-7 indexes straight into what `Intl` says
 * and the comparison below reads as "later in the week than".
 */
const ISO_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The schedule, creating the settings row with its defaults if nothing has
 * asked for it yet. Shared by the cron job and the card on Stats, so the
 * screen cannot show a schedule the sender is not using.
 */
export async function getQuotaSchedule(): Promise<{
  on: boolean;
  weekday: number;
  hour: number;
}> {
  let [setting] = await db.select().from(appSetting).limit(1);
  if (!setting) [setting] = await db.insert(appSetting).values({}).returning();
  return {
    on: setting.quotaDigestOn,
    weekday: setting.quotaDigestWeekday,
    hour: setting.quotaDigestHour,
  };
}

/**
 * Their local weekday and hour.
 *
 * `Intl` rather than arithmetic so daylight saving stays the zone database's
 * problem, the same way `callback-reminders.ts` reads a person's day.
 */
function localNow(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    // h23, since hour12:false renders midnight as 24 in some locales.
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // 1-7, Monday first. 0 for a name we do not know, which fails closed: it
  // never matches a configured day.
  const iso = ISO_DAYS.indexOf(weekday as (typeof ISO_DAYS)[number]) + 1;
  return { iso, hour };
}

/**
 * Past the configured moment, and still inside the same pay week.
 *
 * **Judged in the recipient's own zone, not `STATS_TZ`.** It was fixed at
 * Friday 17:00 Eastern on the reasoning that the quota *week* is cut in
 * Eastern — but that confused the window being measured with the moment
 * somebody is told about it, and delivered at 05:00 on Saturday to founders in
 * Singapore. The week stays Eastern; the send follows the reader's clock, as
 * the payday reminder does.
 *
 * The "later in the week" half is what turns a worker outage on Friday evening
 * into a digest on Saturday rather than a week nobody was told about; the
 * per-week claim is what stops that becoming two.
 */
function inWindowFor(tz: string, wantDay: number, wantHour: number, now: Date) {
  const { iso, hour } = localNow(tz, now);
  if (iso === 0) return false;
  return iso > wantDay || (iso === wantDay && hour >= wantHour);
}

/**
 * How many names the push body carries before it starts counting instead.
 *
 * A notification body is truncated somewhere around a hundred characters, and
 * the list is sorted worst-first — so an uncapped list of eight loses its tail,
 * which on this list is the people nearest the target and the least urgent to
 * read. Capping keeps the ones that matter and says how many are behind them;
 * Stats is one tap away for the rest.
 */
const NAMES_IN_BODY = 5;

export type QuotaDigestResult = {
  skipped?: "unconfigured" | "switched-off" | "not-due-yet";
  weekStart?: string;
  /** Callers the digest judged, i.e. those with a niche to work. */
  considered?: number;
  under?: number;
  sent?: number;
  deliveries?: number;
};

export type QuotaStanding = {
  name: string;
  calls: number;
  /**
   * How long this person has been on the team, and how much of the quota week
   * they have actually been here for.
   *
   * Asked for on 2026-09-19: a name at the bottom of this list means one of
   * two completely different things — somebody who started on Wednesday, or
   * somebody with a problem — and the list could not tell them apart. It does
   * not change what is owed: the number stays out of 300, because pro-rating
   * a quota is a decision about pay and this card is a report.
   */
  daysOnTeam: number;
  /** Their first quota week, where a shortfall is arithmetic rather than news. */
  startedThisWeek: boolean;
  /** Days of the week they have been here for, when that is fewer than all of
   *  it. Null once they have been here a full week. */
  daysOfWeek: number | null;
};

/**
 * Where every caller stands against the quota this week.
 *
 * Shared by the Friday notification and the card on Stats rather than each
 * counting its own way — two answers to "did they hit 300" put two numbers in
 * front of one founder, and the one they act on had better be the one that
 * was sent. The same reason the caller's own bar counts through
 * `getCallTotals`.
 *
 * Deliberately **not** scoped by the Stats range picker: this is Payroll's
 * week, Monday to now, and a quota that moved with a dropdown would let
 * somebody change how much work is owed by changing a filter. The card says
 * so, or the numbers look broken when the range changes and this does not.
 */
export async function getQuotaStandings(): Promise<{
  weekStart: string;
  /** The instant the week began, so a screen can name the reset rather than
   *  guessing at it. The card said "since Monday" for a day after the week
   *  moved to payday on 2026-09-18, which is a label disagreeing with its own
   *  number. */
  since: string;
  standings: QuotaStanding[];
}> {
  // The same week the caller's own bar counts: from the last payday, not from
  // a Monday. Two definitions would put two numbers in front of one person.
  const { at: weekStartedAt, weekStart } = await quotaWeekStart();

  // **Only callers who could actually have rung somebody**, which takes two
  // conditions and not one. A niche to work, and a way to dial it: a number of
  // their own, or `dial_method = 'handset'`, which needs none because they ring
  // from their own phone.
  //
  // Both halves earned their place the day this was built. The first draft
  // tested only for a niche, and three accounts set up that morning — given
  // lists but not yet numbers — came back in the list at zero calls, which is
  // precisely the noise that buries the one name worth reading. Somebody who
  // cannot place a call is not behind on their quota; they are waiting on an
  // admin, and that is a different message to a different person.
  //
  // The third condition is the narrow one, and it has to be narrow. Somebody
  // hired this week who has not dialled at all is still being set up, not
  // behind — but "joined this week" alone is far too wide a brush: two of the
  // people working hardest the day this was built had been added within the
  // week, one of them a third of the way to quota already. So it excludes only
  // the pairing of both: new *and* never once dialled.
  const callers = (await db.execute(sql`
    select u.id, u.name, u.created_at
    from app_user u
    where u.role = 'caller' and u.active
      and (u.telnyx_did is not null or u.dial_method = 'handset')
      and exists (
        select 1 from call_list cl where cl.assigned_user_id = u.id
      )
      and not (
        (u.created_at at time zone ${STATS_TZ})::date >= ${weekStart}::date
        and not exists (select 1 from call c where c.user_id = u.id)
      )
    order by u.name
  `)) as Row[];

  // Counted through `getWeekProgress`, never a query of its own, so "a call"
  // means what it means on the caller's own bar, on Stats and on the
  // Scoreboard.
  const standings: QuotaStanding[] = [];
  // Whole days, floored, off the instant rather than the calendar: "joined
  // yesterday evening" is one day on the team, not two, whichever side of
  // midnight the two timestamps fall.
  const nowMs = Date.now();
  // The instant the week began, not its date: `weekStart` is that day in
  // Eastern, and reading it as UTC midnight would put this up to a day out —
  // the week actually starts at the payday hour on it (Friday 9 PM EDT).
  const weekStartMs = weekStartedAt.getTime();
  for (const c of callers) {
    const { calls } = await getWeekProgress(n(c.id));
    const joinedMs = new Date(String(c.created_at)).getTime();
    const daysOnTeam = Math.max(
      0,
      Math.floor((nowMs - joinedMs) / 86_400_000),
    );
    // Present for part of the week only: from whichever came later, their
    // start or the week's, to now. Rounded up, since an afternoon on the
    // phones is a day somebody was here to ring.
    const heldMs = nowMs - Math.max(joinedMs, weekStartMs);
    const daysOfWeek = Math.max(1, Math.ceil(heldMs / 86_400_000));
    standings.push({
      name: String(c.name ?? "Unknown"),
      calls,
      daysOnTeam,
      startedThisWeek: joinedMs > weekStartMs,
      daysOfWeek: daysOfWeek < 7 ? daysOfWeek : null,
    });
  }
  // Worst first: the top of this list is the only part anybody needs to act on.
  standings.sort((a, b) => a.calls - b.calls);
  return { weekStart, since: weekStartedAt.toISOString(), standings };
}

export async function sendQuotaDigest(
  now: Date = new Date(),
): Promise<QuotaDigestResult> {
  if (!pushConfigured()) return { skipped: "unconfigured" };

  const schedule = await getQuotaSchedule();
  if (!schedule.on) return { skipped: "switched-off" };

  // Founders first, and the window judged per founder in their own zone, so
  // the standings are only computed once somebody is actually due one. That
  // ordering matters: working out where eight callers stand costs a query
  // each, and on all but one tick a week the answer is thrown away.
  const founders = (await db.execute(sql`
    select distinct u.id, u.stats_region, u.call_region
    from app_user u
    join push_subscription ps on ps.user_id = u.id
    where u.active and u.role = 'admin'
  `)) as Row[];

  const due = founders.filter((f) =>
    inWindowFor(
      statsZone(f.stats_region ?? f.call_region).tz,
      schedule.weekday,
      schedule.hour,
      now,
    ),
  );
  if (due.length === 0) return { skipped: "not-due-yet" };

  // The same roster and the same counts the card on Stats renders — one
  // definition of "is this person behind", shared, rather than a copy here and
  // a copy there that drift into disagreeing about who to chase. Already
  // sorted worst first, and it carries the week it counted, which is what the
  // claim below is keyed on.
  const { standings, weekStart } = await getQuotaStandings();
  const under = standings.filter((s) => s.calls < WEEKLY_CALL_QUOTA);

  const result: QuotaDigestResult = {
    weekStart,
    considered: standings.length,
    under: under.length,
    sent: 0,
    deliveries: 0,
  };

  // Sent even when nobody missed. Once a week is not noise, and silence is
  // ambiguous — "everyone hit it" and "the job stopped running" must not look
  // the same from the outside.
  const title =
    under.length === 0
      ? `Everyone hit ${WEEKLY_CALL_QUOTA} this week`
      : under.length === 1
        ? `1 caller under ${WEEKLY_CALL_QUOTA} this week`
        : `${under.length} callers under ${WEEKLY_CALL_QUOTA} this week`;

  // Worst first — `under` is sorted ascending by calls — so the truncation
  // falls on the people nearest the target rather than the furthest from it.
  const body =
    under.length === 0
      ? `All ${standings.length} hit the quota.`
      : [
          under
            .slice(0, NAMES_IN_BODY)
            // "(new)" only for a first week, and only there. The body is
            // truncated near a hundred characters, so the tag has to earn its
            // six of them — and it earns them on exactly the rows where a low
            // number means something different. The card on Stats has the
            // room to say how many days; this does not.
            .map((s) => `${s.name} ${s.calls}${s.startedThisWeek ? " (new)" : ""}`)
            .join(" · "),
          under.length > NAMES_IN_BODY
            ? `+${under.length - NAMES_IN_BODY} more`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

  for (const f of due) {
    const id = n(f.id);
    // Claimed by an insert rather than decided by a check: the worker ticks
    // every five minutes and two overlapping ticks can both pass a check.
    // Written before the push, so a failure costs one missed digest rather
    // than a loop of them.
    const claimed = (await db.execute(sql`
      insert into quota_digest_sent (user_id, week_start, under_quota)
      values (${id}, ${weekStart}, ${under.length})
      on conflict (user_id, week_start) do nothing
      returning id
    `)) as Row[];
    if (claimed.length === 0) continue;

    result.deliveries =
      (result.deliveries ?? 0) +
      (await pushToUser(id, {
        title,
        body,
        // Stats rather than the Scoreboard: it opens on the last seven days
        // and carries the By-person table, where the Scoreboard opens on today
        // and would answer a question about the week with one shift's numbers.
        url: "/call-stats",
        // Its own tag, so a quota digest never replaces an unread meeting
        // reminder — those are the expensive ones to lose.
        tag: "cylrm-quota",
      }));
    result.sent = (result.sent ?? 0) + 1;
  }

  return result;
}
