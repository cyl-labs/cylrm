import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSetting } from "@/db/schema";
import { payWeekStart } from "@/lib/call-stats";
import { formatMoney, getPayroll } from "@/lib/payroll";
import { pushConfigured, pushToUser } from "@/lib/push";
import { statsZone } from "@/lib/stats-zones";

/**
 * The payday reminder: what the floor is owed, on the day the money goes out.
 *
 * Payroll is manual on purpose — nothing resets on a timer and nothing pays
 * anybody — which makes the one thing it cannot survive a founder simply
 * forgetting it is Friday. Everything else on that screen waits patiently; the
 * people waiting to be paid do not.
 *
 * **Founders only**, like the screen it points at. What a caller is owed is
 * already on their own Stats, and a notification telling somebody they are
 * owed money they cannot pay themselves is a complaint with nowhere to go.
 *
 * The schedule is settable (`app_setting.payroll_reminder_*`) rather than a
 * constant, because payday is a business decision and the only certain thing
 * about it is that it moves.
 */

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** ISO weekday order, so a stored 1-7 indexes straight into what `Intl` says
 *  and the comparison below reads as "later in the week than". */
const ISO_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type PayrollReminderResult = {
  skipped?: "unconfigured" | "switched-off";
  weekStart?: string;
  owedCents?: number;
  owedTo?: number;
  sent?: number;
  deliveries?: number;
};

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
  // 1-7, Monday first. 0 for a name Intl gave us that we do not know, which
  // fails closed: it never matches a configured day.
  const iso = ISO_DAYS.indexOf(weekday as (typeof ISO_DAYS)[number]) + 1;
  return { iso, hour };
}

/**
 * The schedule as it stands, creating the settings row with its defaults if
 * nothing has asked for it yet.
 *
 * Shared by the cron job and the card on Payroll rather than each reading the
 * row its own way: a screen showing a schedule the sender is not using is
 * worse than a screen showing none.
 */
export async function getPayrollReminderSetting(): Promise<{
  on: boolean;
  weekday: number;
  hour: number;
}> {
  let [setting] = await db.select().from(appSetting).limit(1);
  if (!setting) [setting] = await db.insert(appSetting).values({}).returning();
  return {
    on: setting.payrollReminderOn,
    weekday: setting.payrollReminderWeekday,
    hour: setting.payrollReminderHour,
  };
}

export async function sendPayrollReminder(
  now: Date = new Date(),
): Promise<PayrollReminderResult> {
  if (!pushConfigured()) return { skipped: "unconfigured" };

  // The single-row settings table, created with its defaults if this is the
  // first thing ever to ask for it — the pattern `scheduler.ts` uses.
  let [setting] = await db.select().from(appSetting).limit(1);
  if (!setting) [setting] = await db.insert(appSetting).values({}).returning();
  if (!setting.payrollReminderOn) return { skipped: "switched-off" };

  const wantDay = setting.payrollReminderWeekday;
  const wantHour = setting.payrollReminderHour;
  const weekStart = payWeekStart();

  const rows = await getPayroll();
  const owed = rows.filter((r) => r.totalCents > 0);
  const owedCents = owed.reduce((sum, r) => sum + r.totalCents, 0);

  const founders = (await db.execute(sql`
    select distinct u.id, u.stats_region, u.call_region
    from app_user u
    join push_subscription ps on ps.user_id = u.id
    where u.active and u.role = 'admin'
  `)) as Row[];

  const result: PayrollReminderResult = {
    weekStart,
    owedCents,
    owedTo: owed.length,
    sent: 0,
    deliveries: 0,
  };

  for (const f of founders) {
    const id = n(f.id);
    const zone = statsZone(f.stats_region ?? f.call_region);
    const { iso, hour } = localNow(zone.tz, now);
    if (iso === 0) continue;

    // Past the configured moment, and still inside the same pay week. The
    // "later in the week" half is what turns a worker outage on Friday evening
    // into a reminder on Saturday rather than a payday nobody was told about;
    // the per-week claim below is what stops that becoming two.
    const due = iso > wantDay || (iso === wantDay && hour >= wantHour);
    if (!due) continue;

    // Claimed by an insert rather than decided by a check: the worker ticks
    // every five minutes and two overlapping ticks can both pass a check.
    // Written before the push, so a failure costs one missed reminder rather
    // than a loop of them.
    const claimed = (await db.execute(sql`
      insert into payroll_reminder_sent (user_id, week_start, owed_cents)
      values (${id}, ${weekStart}, ${owedCents})
      on conflict (user_id, week_start) do nothing
      returning id
    `)) as Row[];
    if (claimed.length === 0) continue;

    // Sent even when nothing is owed. Once a week is not noise, and silence is
    // ambiguous — "nobody is owed anything" and "the job stopped running" must
    // not look the same from outside.
    const title =
      owed.length === 0
        ? "Payday: nothing owed"
        : `Payday: ${formatMoney(owedCents)} owed`;
    const body =
      owed.length === 0
        ? "Nobody has a balance this week."
        : `${owed.length} ${owed.length === 1 ? "person" : "people"}: ` +
          owed
            .map((r) => `${r.name} ${formatMoney(r.totalCents)}`)
            .join(" · ");

    result.deliveries =
      (result.deliveries ?? 0) +
      (await pushToUser(id, {
        title,
        body,
        url: "/payroll",
        // Its own tag, so a payday reminder never replaces an unread meeting
        // reminder or the quota digest that lands the same evening.
        tag: "cylrm-payroll",
      }));
    result.sent = (result.sent ?? 0) + 1;
  }

  return result;
}
