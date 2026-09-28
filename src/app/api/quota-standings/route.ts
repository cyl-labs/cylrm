import { getCurrentUser } from "@/lib/session";
import { getQuotaStandings } from "@/lib/quota-digest";

/**
 * Where the floor stands against the quota this week, asked for rather than
 * rendered.
 *
 * The card on Stats used to be worked out with the page, for everybody who
 * opened it, whether or not they scrolled to it. It was the most expensive
 * thing on that screen by a distance — see `getQuotaStandings` — and it is the
 * one card on it that answers a weekly question rather than a daily one. So it
 * is behind a button now, and this is what the button calls.
 *
 * **`/api` is outside the middleware matcher**, so the role is checked here
 * rather than assumed, the same way the SOP export route checks it. Founders
 * only: a caller reading everybody else's numbers is what `/call-stats` is
 * split in two to prevent, and a route that skipped the check would undo that
 * split without touching the screen.
 */
/** How far back the week picker on the Scoreboard reaches. */
const MAX_WEEKS_BACK = 12;

export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "The floor's standings are admin-only." },
      { status: 403 },
    );
  }

  // `?back=1` is last week. Clamped rather than refused: a bad number in the
  // address should show a real week, not an error.
  const raw = Number(new URL(request.url).searchParams.get("back") ?? 0);
  const back = Number.isInteger(raw)
    ? Math.min(Math.max(raw, 0), MAX_WEEKS_BACK)
    : 0;
  return Response.json(await getQuotaStandings(back));
}
