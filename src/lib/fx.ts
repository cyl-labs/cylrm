/**
 * One exchange rate, for reading a US bill in Singapore dollars.
 *
 * Telnyx bills in USD and that is the only currency any figure here is
 * actually denominated in. Converting is a convenience for the two people
 * paying from a Singapore account, so the rule is: **convert, but never let
 * the screen forget which currency it was billed in.** Every converted view
 * says the rate and when it was taken, because a money figure with no currency
 * on it is the kind of thing that ends up in a spreadsheet meaning the wrong
 * number.
 *
 * `open.er-api.com` needs no key and updates daily, which is the right shape
 * for this: a rate good to four decimal places, refreshed more often than the
 * bill changes.
 */

const API = "https://open.er-api.com/v6/latest/USD";
const TIMEOUT_MS = 8_000;

/** Rates move daily at most, and a stale one is a rounding error rather than a
 *  wrong answer. Half a day keeps it fresh without making this a dependency of
 *  every page load. */
const CACHE_MS = 12 * 60 * 60_000;

export type Rate = {
  /** Multiply USD by this. */
  rate: number;
  /** When the provider last set it, so the screen can say. */
  at: string;
};

let cached: { at: number; value: Rate } | null = null;

/**
 * USD → SGD, or null.
 *
 * Null on any failure, and the caller falls back to showing dollars. A screen
 * that cannot reach a rate provider should quietly stay in USD, never show a
 * guessed conversion and never fail to render the bill.
 */
export async function usdToSgd(): Promise<Rate | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return cached?.value ?? null;
    const body = (await res.json()) as {
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    const rate = body.rates?.SGD;
    if (!rate || !Number.isFinite(rate)) return cached?.value ?? null;
    const value: Rate = {
      rate,
      at: body.time_last_update_utc ?? new Date().toUTCString(),
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    // A rate we fetched this morning beats no rate at all.
    return cached?.value ?? null;
  }
}
