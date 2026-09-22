/**
 * Notice when a call loses its recording.
 *
 * On 2026-09-21 Telnyx's recording-publish pipeline failed for about two and a
 * half hours on one of its sites. **34 answered calls captured their audio in
 * full and never published it** — 2,008 seconds, including the call that
 * booked a demo. From our side every one of them looked completely normal:
 * `call.hangup` arrived, the duration was right, the invoice was right. Only
 * the audio was missing, and nothing was looking, so it surfaced three days
 * later when somebody opened a briefing and found it blank.
 *
 * Telnyx confirmed there is no `recording.failed` webhook and recommended
 * absence-based alerting — for every hangup on a recording-enabled
 * connection, alert if no recording arrives within a few minutes. This is
 * that, plus the row that stops it saying the same thing every five minutes.
 *
 * Deliberately *not* a daily digest, unlike the callbacks and quota jobs it
 * sits beside in the worker. Those report on a day that is over; this reports
 * a fault that is still happening, and the whole value is hearing about it
 * during the shift rather than after it.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationsConfigured, notifyRecordingGap } from "@/lib/notify";

/**
 * How long after a call ends before a missing recording counts as missing.
 *
 * Telnyx publishes about one to two seconds after hangup, and our webhook has
 * to land on top of that. Ten minutes is far beyond both and cheap: the cost
 * of waiting is that an alert arrives ten minutes late, and the cost of not
 * waiting is crying wolf at every caller on a slow afternoon, which is how an
 * alert gets muted and stops working at all.
 */
const GRACE_MINUTES = 10;

/**
 * How far back a tick will look.
 *
 * Long enough to survive the app being down for a few hours, short enough that
 * a restored backup or a bulk import cannot announce a month of history as if
 * it had just happened. Anything older is a reconciliation question, and the
 * table is seeded so it is already answered.
 */
const LOOKBACK_HOURS = 48;

/** Named in the alert. More than this and the names stop being the point. */
const NAMES_IN_ALERT = 6;

export type GapSweep = {
  found: number;
  notified: boolean;
  /** Set when something was found but could not be announced. */
  problem?: string;
};

/**
 * Find calls whose recording never arrived, claim them, and say so once.
 *
 * A call qualifies when it has a Telnyx session, actually connected, ended
 * more than `GRACE_MINUTES` ago, and has no `call_recording` row. A call that
 * never connected has no audio to lose and is not a fault.
 *
 * The insert is the claim: `on conflict do nothing` on the unique `call_id`
 * means two ticks racing cannot both report the same call, and `returning`
 * says which rows this tick actually won. That is the same shape the payroll
 * reminder uses to make a weekly job safe on a five-minute loop.
 */
export async function sweepRecordingGaps(): Promise<GapSweep> {
  const claimed = (await db.execute(sql`
    insert into call_recording_gap
      (call_id, telnyx_session_id, duration_seconds, called_at, user_id)
    select c.id, c.telnyx_session_id, c.duration_seconds, c.called_at, c.user_id
    from "call" c
    left join call_recording cr on cr.call_session_id = c.telnyx_session_id
    where c.telnyx_session_id is not null
      and cr.id is null
      -- Connected. A call nobody answered has no audio to lose.
      and coalesce(c.duration_seconds, 0) > 0
      -- Past the grace period, so a recording still in flight is not a fault.
      and c.called_at < now() - make_interval(mins => ${GRACE_MINUTES}::int)
      and c.called_at > now() - make_interval(hours => ${LOOKBACK_HOURS}::int)
    on conflict (call_id) do nothing
    returning call_id, duration_seconds, user_id
  `)) as unknown as Record<string, unknown>[];

  if (claimed.length === 0) return { found: 0, notified: false };

  // Who and how much, for a message that can be acted on without opening
  // anything. A gap is a per-person fault far more often than a global one —
  // Sunday was one connection while eight others recorded normally — so the
  // name is the most useful single word in it.
  const ids = claimed.map((r) => Number(r.call_id));
  const rows = (await db.execute(sql`
    select coalesce(u.name, 'Unknown') as who, count(*)::int as n,
           sum(coalesce(g.duration_seconds, 0))::int as seconds
    from call_recording_gap g
    left join app_user u on u.id = g.user_id
    where g.call_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
    group by 1
    order by n desc
  `)) as unknown as Record<string, unknown>[];

  const total = claimed.length;
  const seconds = rows.reduce((a, r) => a + Number(r.seconds ?? 0), 0);
  const who = rows
    .slice(0, NAMES_IN_ALERT)
    .map((r) => `${String(r.who)} ${r.n}`)
    .join(", ");

  if (!notificationsConfigured()) {
    // Claimed but unannounced. The row stands, so this is visible in the table
    // even where nothing can be sent — and it is not re-reported later, which
    // is the right trade: a gap reported late is worse than one reported in a
    // place somebody has to go and look.
    return { found: total, notified: false, problem: "Telegram not configured" };
  }

  try {
    await notifyRecordingGap({
      calls: total,
      seconds,
      who,
      more: Math.max(0, rows.length - NAMES_IN_ALERT),
    });
  } catch (err) {
    return {
      found: total,
      notified: false,
      problem: err instanceof Error ? err.message : "Could not send the alert",
    };
  }

  await db.execute(sql`
    update call_recording_gap set notified_at = now()
    where call_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);

  return { found: total, notified: true };
}
