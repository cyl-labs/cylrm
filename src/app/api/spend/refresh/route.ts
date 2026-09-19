import { getCurrentUser } from "@/lib/session";
import { SPEND_DAYS, getSpend, isSpendDays } from "@/lib/telnyx-usage";

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
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }

  // Refresh the window the screen is actually showing. Each is a separate
  // report out of Telnyx and cached separately, so forcing the default while
  // somebody is looking at 90 days would leave the number they pressed for
  // exactly as stale as it was.
  const asked = new URL(request.url).searchParams.get("days");
  const days = isSpendDays(asked) ? Number(asked) : SPEND_DAYS;
  const spend = await getSpend(days as 7 | 30 | 90, true);
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
