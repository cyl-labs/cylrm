import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  DAILY_FALL_ALERT_PCT,
  getNumberHealth,
  type NumberHealth,
} from "@/lib/number-health";
import {
  notificationsConfigured,
  notifyNumberFell,
  notifyNumberFlagged,
} from "@/lib/notify";

/**
 * Tell the founders on Telegram when a number turns "probably flagged as spam"
 * (2026-10-03).
 *
 * Runs on the worker's five-minute tick over the same `getNumberHealth` the
 * Team panel draws from, so the message and the screen cannot disagree.
 *
 * **Announced once, not every tick.** `number_alert` remembers what was last
 * said per number. An alert goes out when a number is flagged and was not
 * flagged at the last look, and then not again for 24 hours even if it dips and
 * returns, so a number hovering at the line cannot buzz a phone all night. A
 * number that stays flagged says nothing more; one that recovers is quietly
 * marked recovered and will be announced afresh if it relapses a day later.
 *
 * The row is claimed before the message is sent (the rule the other cron jobs
 * follow), and handed back if Telegram refuses, so a failed send is retried on
 * the next tick instead of being lost.
 *
 * Only numbers somebody active is dialling from: a number nobody holds cannot
 * lose a call.
 */
const COOLDOWN_HOURS = 24;

/**
 * The second alert (2026-10-03): the last 24 hours' connect rate fell by a
 * quarter or more against the 7 days before, whatever the verdict says. The
 * weekly verdict is slow by design; this is the "kill it and rotate" signal
 * that catches a cliff the day it happens. It is separate from the flagged
 * alert, with its own 24 hour cooldown (`fell_alerted_at`), and says plainly
 * that a change of lists would look the same, since the CRM cannot tell.
 */
async function sendFellAlert(
  num: string,
  names: string[],
  info: NumberHealth,
  result: { alerted: string[]; failed: string[] },
) {
  const d = info.daily;
  if (!d || d.fellPct < DAILY_FALL_ALERT_PCT) return;
  const claimed = (await db.execute(sql`
    update number_alert set fell_alerted_at = now()
    where phone_number = ${num}
      and (fell_alerted_at is null
           or fell_alerted_at < now() - make_interval(hours => ${COOLDOWN_HOURS}::int))
    returning phone_number
  `)) as unknown as { phone_number: string }[];
  if (claimed.length === 0) return;
  try {
    await notifyNumberFell({
      number: num,
      holders: names,
      today: d.today,
      usual: d.usual,
      fellPct: d.fellPct,
      calls: d.todayCalls,
    });
    result.alerted.push(`${num} (fell)`);
  } catch (err) {
    console.error("[number-alerts] telegram failed:", String(err).slice(0, 200));
    await db.execute(sql`
      update number_alert set fell_alerted_at = null where phone_number = ${num}
    `);
    result.failed.push(num);
  }
}

/** The reasons, in plain sentences, from the same figures the panel reads. */
export function reasonsFor(h: NumberHealth): string[] {
  const out: string[] = [];
  if (h.fastFail !== null && h.fastFail >= h.limits.fastWatch) {
    out.push(
      `${h.fastFail} out of 100 calls were dropped within 8 seconds${h.fastFailBefore !== null ? ` (${h.fastFailBefore} the week before)` : ""}.`,
    );
  }
  if (h.refused !== null && h.refused >= h.limits.fastWatch) {
    out.push(`${h.refused} out of 100 were refused outright by the carrier or phone.`);
  }
  if (h.reach !== null) {
    out.push(
      `Only ${h.reach} out of 100 calls got through this week${h.reachBefore !== null ? ` (${h.reachBefore} the week before)` : ""}.`,
    );
  }
  if (h.redial !== null && h.redial >= h.limits.redialWatch) {
    out.push(
      `${h.redial} out of 100 calls had to be redialled within 3 minutes, which is what happens when people do not pick up the first time.`,
    );
  }
  if (h.basis === "lengths" && h.lengths) {
    out.push(
      `Only ${h.lengths.longPct} out of 100 of its ${h.lengths.n} recorded calls ran past 30 seconds, and ${h.lengths.shortPct} ended within 10 seconds.`,
    );
  }
  return out;
}

export async function sendNumberAlerts(): Promise<{
  checked: number;
  alerted: string[];
  failed: string[];
}> {
  const result = { checked: 0, alerted: [] as string[], failed: [] as string[] };
  if (!notificationsConfigured()) return result;

  const health = await getNumberHealth();
  const holders = (await db.execute(sql`
    select telnyx_did as num, array_agg(name order by name) as names
    from app_user where active and telnyx_did is not null
    group by telnyx_did
  `)) as unknown as { num: string; names: string[] }[];

  for (const h of holders) {
    const info = health[h.num];
    if (!info) continue;
    result.checked += 1;

    await db.execute(sql`
      insert into number_alert (phone_number) values (${h.num})
      on conflict (phone_number) do nothing
    `);

    await sendFellAlert(h.num, h.names, info, result);

    if (info.status !== "flagged") {
      // Recovered, or never flagged: remember it, say nothing.
      await db.execute(sql`
        update number_alert set last_status = ${info.status}
        where phone_number = ${h.num} and last_status <> ${info.status}
      `);
      continue;
    }

    const [prev] = (await db.execute(sql`
      select last_status, alerted_at from number_alert where phone_number = ${h.num}
    `)) as unknown as { last_status: string; alerted_at: string | null }[];

    const claimed = (await db.execute(sql`
      update number_alert
      set last_status = 'flagged', alerted_at = now()
      where phone_number = ${h.num}
        and last_status <> 'flagged'
        and (alerted_at is null
             or alerted_at < now() - make_interval(hours => ${COOLDOWN_HOURS}::int))
      returning phone_number
    `)) as unknown as { phone_number: string }[];
    if (claimed.length === 0) {
      // Still flagged and already told, or told inside the cooldown. Keep the
      // status current so the next recovery is noticed.
      await db.execute(sql`
        update number_alert set last_status = 'flagged' where phone_number = ${h.num}
      `);
      continue;
    }

    try {
      await notifyNumberFlagged({
        number: h.num,
        holders: h.names,
        reasons: reasonsFor(info),
      });
      result.alerted.push(h.num);
    } catch (err) {
      console.error("[number-alerts] telegram failed:", String(err).slice(0, 200));
      // Handed back, so the next tick tries again.
      await db.execute(sql`
        update number_alert
        set last_status = ${prev?.last_status ?? "unknown"},
            alerted_at = ${prev?.alerted_at ?? null}
        where phone_number = ${h.num}
      `);
      result.failed.push(h.num);
    }
  }
  return result;
}
