import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Calls a founder has put on the Meetings calendar for themselves (2026-09-24).
 *
 * Asked for as a way to say "I'll ring this one back myself" from a meeting,
 * with two constraints that ruled out everything already built: it must not
 * be a callback, which is the floor's work order and lands in a caller's queue
 * and morning reminder, and it must not be a reschedule, because moving a
 * Cal.com booking emails the prospect. So it is its own entry in its own
 * table (`founder_call`), shown only to founders, sent nowhere.
 *
 * It is drawn as the meeting it came from, moved to its time: `lib/meetings.ts`
 * joins the open one onto its meeting as `callBack`. Closed when its ring back
 * is logged as rebooked or not rebooking.
 */

/** How many are due now, for the founders' Meetings badge. One small indexed
 *  count, run only for founders. */
export async function countFounderCallsDue(): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as n from founder_call
    where done_at is null and start_at <= now()
  `)) as { n: number }[];
  return row?.n ?? 0;
}
