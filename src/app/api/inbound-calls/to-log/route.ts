import { getRingBacksToLog } from "@/lib/inbound";
import { getCurrentUser } from "@/lib/session";
import { readerZone } from "@/lib/users";

/**
 * Ring-backs the signed-in person answered and has not logged — what the
 * "Log your call with…" card shows. See `getRingBacksToLog`.
 *
 * With the reader's own zone, which the call-back box falls back to for a
 * number that belongs to no place — the same rule the dial card follows.
 */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [calls, zone] = await Promise.all([
    getRingBacksToLog(me),
    readerZone(me.id),
  ]);
  return Response.json({ calls, readerTz: zone.tz });
}
