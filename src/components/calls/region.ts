import type { CallRegion } from "@/lib/calls";

/**
 * Market names, for the folders on the call lists screen.
 *
 * Here rather than in `lib/calls` for the same reason `outcome.ts` exists:
 * that module imports the Postgres client, so a client component taking a
 * *value* from it drags the driver into the browser bundle and the build
 * fails. Types are erased, so `import type` above is safe.
 */

export const REGION_LABELS: Record<CallRegion, string> = {
  sg: "Singapore",
  us: "United States",
  gb: "United Kingdom",
};

/** For the chip on a card, where there is room for two characters. */
export const REGION_SHORT: Record<CallRegion, string> = {
  sg: "SG",
  us: "US",
  gb: "UK",
};

/** Folder order on screen. Singapore first because that is where the live
 *  lead base is; unfiled lists sort last, after every named folder. */
export const REGION_ORDER: CallRegion[] = ["sg", "us", "gb"];
