import { getCurrentUser } from "@/lib/session";
import { getSpend } from "@/lib/telnyx-usage";

/**
 * Pull Telnyx's usage reports now, past the hour-long cache.
 *
 * Admin-only, like the screen it serves. `/api` is outside the middleware
 * matcher, so this check is the only one there is — the Spend screen's own
 * guard does nothing for a route.
 *
 * Unlike the meetings refresh there is no separate cooldown: `getSpend` folds
 * concurrent presses into one in-flight pull, and a founder pressing this
 * twice costs a handful of read-only requests against an API we are billed
 * nothing to read.
 */
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }

  const spend = await getSpend(true);
  if (spend.skipped === "unconfigured") {
    return Response.json({ skipped: "unconfigured" });
  }
  // A failed pull answers 200 with the reason rather than an error status: the
  // screen still has the last good figures to show, and the button's job is to
  // say what happened rather than to throw.
  return Response.json({
    error: spend.error,
    total: spend.total,
    fetchedAt: spend.fetchedAt,
  });
}
