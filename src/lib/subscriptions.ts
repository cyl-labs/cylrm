import { asc } from "drizzle-orm";
import { db } from "@/db";
import { subscription } from "@/db/schema";

export type Subscription = typeof subscription.$inferSelect;

/** What one subscription costs per month, in its own currency. */
export function monthlyCents(s: Pick<Subscription, "amountCents" | "period">) {
  return s.period === "year" ? s.amountCents / 12 : s.amountCents;
}

/**
 * What the active subscriptions cost over a window, in US dollars.
 *
 * A year is 365 days and a month is a twelfth of it, so 30 days of a $100
 * monthly bill is $98.63 rather than a flat $100: the same rule for every
 * window, so 7, 30 and 90 days add up to something comparable.
 *
 * `sgdPerUsd` is null when the rate could not be fetched. Singapore-dollar
 * bills are then left out and counted in `unconverted`, because a guessed
 * rate on a bill is worse than a total that says it is short.
 */
export async function getSubscriptions(days: number, sgdPerUsd: number | null) {
  const rows = await db
    .select()
    .from(subscription)
    .orderBy(asc(subscription.name));
  let total = 0;
  let monthly = 0;
  let unconverted = 0;
  for (const s of rows) {
    if (!s.active) continue;
    if (s.currency === "sgd" && !sgdPerUsd) {
      unconverted++;
      continue;
    }
    const usdPerMonth =
      (monthlyCents(s) / 100) / (s.currency === "sgd" ? sgdPerUsd! : 1);
    monthly += usdPerMonth;
    total += (usdPerMonth * 12 * days) / 365;
  }
  return { rows, total, monthly, unconverted };
}
