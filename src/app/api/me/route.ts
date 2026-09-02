import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { isStatsRegion } from "@/lib/stats-zones";
import { getCurrentUser } from "@/lib/session";

/**
 * The settings a person may change about themselves.
 *
 * Deliberately not `/api/users/[id]`: that route is the Team screen's, admin
 * only, and it decides roles, markets and who is switched off. Nothing here
 * grants anything — the one field is which clock they read the numbers in —
 * so it is guarded by having a session and nothing more, and it can only ever
 * write to the account making the request. A route that took an id would have
 * to be trusted not to be handed somebody else's.
 */
export async function PATCH(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    statsRegion?: unknown;
    panelLeft?: unknown;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const values: {
    statsRegion?: "sg" | "us" | "gb" | null;
    panelLeft?: "objections" | "script";
  } = {};

  if ("panelLeft" in body) {
    if (body.panelLeft !== "objections" && body.panelLeft !== "script") {
      return Response.json({ error: "Invalid panel." }, { status: 400 });
    }
    values.panelLeft = body.panelLeft;
  }

  if ("statsRegion" in body) {
    // Null clears it back to Eastern, which is the default rather than an
    // absence of one. An unknown market is refused rather than silently
    // stored: it would read as Eastern on every screen while the picker
    // showed something else.
    if (body.statsRegion === null || body.statsRegion === "") {
      values.statsRegion = null;
    } else if (isStatsRegion(body.statsRegion)) {
      values.statsRegion = body.statsRegion;
    } else {
      return Response.json({ error: "Unknown timezone." }, { status: 400 });
    }
  }

  if (Object.keys(values).length === 0) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  await db.update(appUser).set(values).where(eq(appUser.id, me.id));
  return Response.json({ ok: true });
}
