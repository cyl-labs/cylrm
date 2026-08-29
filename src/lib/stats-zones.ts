/**
 * The clocks the calling numbers can be read in, and nothing else.
 *
 * A module of its own for the reason `lib/phone.ts` and
 * `components/calls/outcome.ts` are: the timezone picker is a client component
 * and `lib/call-stats.ts` imports the Postgres client, so importing a *value*
 * from there drags the driver into the browser bundle and the page fails to
 * build. Types are erased and safe; these are not. `call-stats.ts` re-exports
 * the lot, so `from "@/lib/call-stats"` keeps working on the server.
 */

/**
 * The zone a reporting "day" is measured in when nobody has said otherwise.
 *
 * It was Singapore until 2026-08-25 and is now Eastern, because that is where
 * the floor's work is: every active caller bar the founders works US niches,
 * and a shift that runs to 6pm New York was landing on two different Singapore
 * days. Since 2026-08-29 a person can pick a different one for themselves —
 * this stays the default, and the only zone Payroll will ever use.
 *
 * Unlike Singapore's fixed +08:00, Eastern has daylight saving, so there is
 * deliberately no offset constant to pair with this: every use goes through
 * Postgres `at time zone` or `Intl`, both of which read the zone database.
 */
export const STATS_TZ = "America/New_York";

/**
 * The clocks a person can choose between, keyed by market.
 *
 * Three, not every IANA zone. The labels are written by hand because `Intl`
 * names one zone and not the other — en-US gives EDT for New York but GMT+1
 * for London, en-GB the reverse — and two zones labelled two different ways in
 * one table is worse than no label at all. These are the markets the app
 * already knows, and each has a name a person would recognise.
 */
export const STATS_ZONES = {
  sg: { tz: "Asia/Singapore", label: "SGT", name: "Singapore" },
  us: { tz: STATS_TZ, label: "ET", name: "Eastern" },
  gb: { tz: "Europe/London", label: "UK", name: "London" },
} as const;

export type StatsRegion = keyof typeof STATS_ZONES;

/** Eastern, which is what both screens measured in before the picker existed.
 *  Someone who never touches it sees no change. */
export const DEFAULT_STATS_REGION: StatsRegion = "us";

export const isStatsRegion = (v: unknown): v is StatsRegion =>
  typeof v === "string" && v in STATS_ZONES;

/** The zone for a market, falling back to Eastern for a null preference or a
 *  stale one out of a URL — the same way a stale `?list=` falls back to every
 *  niche rather than reporting zeroes. */
export const statsZone = (region: unknown) =>
  STATS_ZONES[isStatsRegion(region) ? region : DEFAULT_STATS_REGION];
