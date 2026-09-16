import { sql } from "drizzle-orm";
import { db } from "@/db";
import { WEEKLY_CALL_QUOTA } from "@/lib/call-quota";
import { getWeekProgress, payWeekStart } from "@/lib/call-stats";
import { STATS_TZ } from "@/lib/stats-zones";
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
 * Friday evening, Eastern — and on through the weekend.
 *
 * The clock is `STATS_TZ` rather than each founder's own, because the quota
 * week is cut in `STATS_TZ`: reading it in a founder's local zone would report
 * a partly-finished week to whoever happened to be furthest ahead. It is the
 * same reason `payWeekStart` ignores the timezone picker.
 *
 * The window runs to the end of Sunday rather than stopping at midnight on
 * Friday. The claim is per week, so a late send cannot duplicate an earlier
 * one, and that turns a worker outage on Friday night from a missed week into
 * a digest that lands on Saturday.
 */
const SEND_FROM_HOUR = 17;

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

function statsNow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STATS_TZ,
    weekday: "short",
    hour: "numeric",
    // h23, since hour12:false renders midnight as 24 in some locales.
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return { weekday, hour };
}

/** Is it late enough in the week to report on it? */
function inWindow(now: Date) {
  const { weekday, hour } = statsNow(now);
  if (weekday === "Sat" || weekday === "Sun") return true;
  return weekday === "Fri" && hour >= SEND_FROM_HOUR;
}

export type QuotaDigestResult = {
  skipped?: "unconfigured" | "not-friday-yet";
  weekStart?: string;
  /** Callers the digest judged, i.e. those with a niche to work. */
  considered?: number;
  under?: number;
  sent?: number;
  deliveries?: number;
};

export async function sendQuotaDigest(
  now: Date = new Date(),
): Promise<QuotaDigestResult> {
  if (!pushConfigured()) return { skipped: "unconfigured" };
  if (!inWindow(now)) return { skipped: "not-friday-yet" };

  const weekStart = payWeekStart();

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
  // The third condition is the narrow one, and it has to be narrow. Somebody
  // hired this week who has not dialled at all is still being set up, not
  // behind — but "joined this week" alone is far too wide a brush: two of the
  // people working hardest the day this was built had been added within the
  // week, one of them a third of the way to quota already. So it excludes only
  // the pairing of both: new *and* never once dialled. Anyone who joined
  // before the week began stays named however little they did, which is the
  // whole point — that is the caller worth asking about.
  const callers = (await db.execute(sql`
    select u.id, u.name
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
  // Scoreboard. A digest disagreeing with the strip they watched all week
  // would be worse than no digest.
  const standings: { name: string; calls: number }[] = [];
  for (const c of callers) {
    const { calls } = await getWeekProgress(n(c.id));
    standings.push({ name: String(c.name ?? "Unknown"), calls });
  }

  const under = standings
    .filter((s) => s.calls < WEEKLY_CALL_QUOTA)
    .sort((a, b) => a.calls - b.calls);

  const founders = (await db.execute(sql`
    select distinct u.id
    from app_user u
    join push_subscription ps on ps.user_id = u.id
    where u.active and u.role = 'admin'
  `)) as Row[];

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
            .map((s) => `${s.name} ${s.calls}`)
            .join(" · "),
          under.length > NAMES_IN_BODY
            ? `+${under.length - NAMES_IN_BODY} more`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

  for (const f of founders) {
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
