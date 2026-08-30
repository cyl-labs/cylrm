import { sql } from "drizzle-orm";
import { db } from "@/db";
import { countCallbacksDueToday } from "@/lib/calls";
import { statsZone } from "@/lib/stats-zones";
import { pushConfigured, pushToUser } from "@/lib/push";

/**
 * The daily "x callbacks due today" nudge.
 *
 * A callback lives nowhere but in this database — no invite goes out, nothing
 * else reminds anybody it was promised — so a diary nobody opens is a promise
 * quietly broken. That is the whole reason this exists.
 *
 * One digest a day rather than a notification per callback, which is the
 * opposite of the meeting rule and deliberately so: a demo is rare and
 * individually valuable, callbacks run at a dozen a day, and a caller who gets
 * a dozen notifications turns notifications off — taking the meeting reminders
 * with them.
 */

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** First thing in their working day, and not before it. The point is a
 *  briefing they act on, so it wants to land as the shift starts. */
const DIGEST_FROM_HOUR = 8;
/** Past this there is no day left to work them in, and it keeps till morning. */
const DIGEST_UNTIL_HOUR = 17;

export type CallbackReminderResult = {
  skipped?: "unconfigured";
  considered: number;
  sent: number;
  deliveries: number;
};

/** Their local date and hour, off `Intl` rather than arithmetic so daylight
 *  saving stays the zone database's problem. */
function localNow(tz: string, now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      // h23, since hour12:false renders midnight as 24 in some locales.
      hourCycle: "h23",
    }).format(now),
  );
  return { date, hour };
}

export async function sendCallbackReminders(
  now: Date = new Date(),
): Promise<CallbackReminderResult> {
  const empty = { considered: 0, sent: 0, deliveries: 0 };
  if (!pushConfigured()) return { ...empty, skipped: "unconfigured" };

  const people = (await db.execute(sql`
    select distinct u.id, u.role, u.stats_region, u.call_region
    from app_user u
    join push_subscription ps on ps.user_id = u.id
    where u.active
  `)) as Row[];

  const result = { ...empty, considered: people.length };

  for (const p of people) {
    const id = n(p.id);
    const zone = statsZone(p.stats_region ?? p.call_region);
    const { date, hour } = localNow(zone.tz, now);
    if (hour < DIGEST_FROM_HOUR || hour >= DIGEST_UNTIL_HOUR) continue;

    // Scoped exactly as the Callbacks screen is for this person, so the
    // notification and the screen they open cannot report different worlds: a
    // caller's own niches, everything for an admin.
    const owner = p.role === "admin" ? undefined : id;
    const due = await countCallbacksDueToday(owner, zone.tz);
    if (due === 0) continue;

    // Claimed by an insert, not decided by a check: the tick runs every five
    // minutes and two overlapping ones can both pass a check. Written before
    // the push, so a failure costs one missed digest rather than a loop.
    const claimed = (await db.execute(sql`
      insert into callback_reminder_sent (user_id, sent_on, callbacks)
      values (${id}, ${date}, ${due})
      on conflict (user_id, sent_on) do nothing
      returning id
    `)) as Row[];
    if (claimed.length === 0) continue;

    const deliveries = await pushToUser(id, {
      title: due === 1 ? "1 callback due today" : `${due} callbacks due today`,
      body: "Open Callbacks to see who is waiting on a call.",
      url: "/callbacks",
      // Its own tag, so this never replaces an unread meeting reminder — those
      // are the expensive ones to lose.
      tag: "cylrm-callbacks",
    });

    result.sent += 1;
    result.deliveries += deliveries;
  }

  return result;
}
