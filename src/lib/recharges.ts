import { desc } from "drizzle-orm";
import { db } from "@/db";
import { recharge } from "@/db/schema";

/** The logged top-ups, and what fell inside the window, in US dollars.
 *  Singapore-dollar entries need the rate and are counted in `unconverted`
 *  when it could not be fetched, like subscriptions. */
export async function getRecharges(days: number, sgdPerUsd: number | null) {
  const rows = await db.select().from(recharge).orderBy(desc(recharge.paidOn), desc(recharge.id));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  let total = 0;
  let unconverted = 0;
  for (const r of rows) {
    if (r.paidOn < since) continue;
    if (r.currency === "sgd" && !sgdPerUsd) {
      unconverted++;
      continue;
    }
    total += r.amountCents / 100 / (r.currency === "sgd" ? sgdPerUsd! : 1);
  }
  return { rows, total, unconverted };
}
