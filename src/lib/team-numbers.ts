/**
 * Which number a person may be given, in one place.
 *
 * Checked when somebody is added and when their number is changed on Team.
 * Two copies of "a US caller rings from a US number" is how one route ends up
 * refusing what the other lets through.
 *
 * Db-free, so the Team screen could use it too without pulling the Postgres
 * client into the browser bundle.
 */

export type MarketId = "sg" | "us" | "gb";

export const MARKET_PREFIX: Record<MarketId, string> = {
  sg: "+65",
  us: "+1",
  gb: "+44",
};

const MARKET_NAME: Record<MarketId, string> = {
  sg: "Singapore",
  us: "US",
  gb: "UK",
};

export const isMarket = (v: unknown): v is MarketId =>
  v === "sg" || v === "us" || v === "gb";

/** Why this number cannot be theirs, or null when it can. A person with no
 *  market works every market, so any well-formed number fits them. */
export function numberProblem(did: string, market: MarketId | null): string | null {
  if (!/^\+[1-9]\d{6,15}$/.test(did)) {
    return "A number has to be in E.164, like +6531258472.";
  }
  if (market && !did.startsWith(MARKET_PREFIX[market])) {
    return `That is not a ${MARKET_NAME[market]} number. Their market decides which numbers they can ring from.`;
  }
  return null;
}
