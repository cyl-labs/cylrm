import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

/**
 * "I have seen those out-of-hours calls."
 *
 * Moves this person's watermark to now, so the banner on Stats counts only
 * calls placed after it. Nothing about the calls themselves changes: they keep
 * their red flag in the call log and the `outcome=outside_hours` filter still
 * finds every one of them. This records that somebody looked.
 *
 * Per person, not per account: Stats is two screens — a founder sees the floor
 * and a caller sees themselves — so a caller clearing their own must not clear
 * the founders' view of it.
 *
 * `/api` is outside the middleware matcher, so `getCurrentUser` is the only
 * guard there is. Open to any signed-in employee, because the worst anybody can
 * do with it is stop being told about their own calls.
 */
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = (await db.execute(sql`
    update app_user set hours_ack_at = now()
    where id = ${me.id}
    returning hours_ack_at
  `)) as Record<string, unknown>[];

  return Response.json({ ackedAt: row?.hours_ack_at ?? null });
}
