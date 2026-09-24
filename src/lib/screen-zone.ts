import { cookies } from "next/headers";
import { isStatsRegion, type StatsRegion } from "@/lib/stats-zones";
import { SCREEN_ZONE_COOKIE, type ZoneScreen } from "@/lib/screen-zone-cookie";

/**
 * The clock a screen with a timezone picker is read in.
 *
 * The URL first — a link says what the sender was looking at — then what was
 * last picked on *this* screen in *this* browser, then the fallback the screen
 * passes (the account's zone, and so on).
 *
 * Per screen and per browser since 2026-09-25. It was one zone saved on the
 * account, so a founder who wanted the Scoreboard in Eastern and Meetings in
 * Singapore had to pick again every time they moved between the two. A
 * cookie rather than localStorage because the server renders the times: a
 * zone the page only learns after hydrating would draw the wrong clock first.
 */
export async function screenRegion(
  screen: ZoneScreen,
  rawTz: unknown,
  fallback: () => Promise<StatsRegion>,
): Promise<StatsRegion> {
  if (isStatsRegion(rawTz)) return rawTz;
  const saved = (await cookies()).get(SCREEN_ZONE_COOKIE(screen))?.value;
  if (isStatsRegion(saved)) return saved;
  return fallback();
}
