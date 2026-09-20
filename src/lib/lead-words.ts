/**
 * How long there is left, said the way the floor says it.
 *
 * Its own db-free module because two screens' worth of components read it —
 * the niche table, the warning above the team, and the row inside it — and one
 * of them is a client component, so it cannot live beside the queries in
 * `lead-stock.ts`. A second copy of the thresholds is two screens disagreeing
 * about whether somebody is in trouble.
 */

/** Below this many days of never-rung leads, a caller's row warns. Three days
 *  because a scrape is not same-day: the warning has to arrive with enough
 *  room to do something about it. */
export const LEAD_LOW_DAYS = 3;

/** Below this it is red rather than amber — tomorrow's problem is today's. */
export const LEAD_URGENT_DAYS = 1;

/**
 * How long a pile has left, in words.
 *
 * Words rather than "8.1", for the reason the Team table says "3 days" rather
 * than a join date: this is read to decide whether to order more leads this
 * week, and a decimal invites arithmetic nobody wants to do. Never rounded
 * down to zero — "0 days" reads as a broken number where "under a day" reads
 * as the thing it is.
 *
 * Every phrase has to read after "in" as well as under a "Runs out in"
 * heading, which is why none of them is a bare number.
 */
export function whenOut(d: number): string {
  if (d < 1) return "under a day";
  if (d < 1.5) return "about a day";
  if (d < 21) return `about ${Math.round(d)} days`;
  if (d < 70) return `about ${Math.round(d / 7)} weeks`;
  return "months";
}

/**
 * The colour a number that size deserves.
 *
 * Under a week is where ordering more has to start, since a scrape is not
 * same-day; ten days is the nudge before it. Returns nothing at all above
 * that, because a screen where every figure is coloured says nothing.
 */
export const urgency = (d: number | null): string =>
  d === null
    ? ""
    : d < 7
      ? "text-destructive"
      : d < 10
        ? "text-amber-600 dark:text-amber-500"
        : "";

/**
 * The same judgement for one caller, whose horizon is days rather than the
 * weeks a whole niche is bought in.
 *
 * **No pace means no colour.** Somebody who has rung nothing this week has no
 * rate to divide by, so their pile is neither big nor small — it is unmeasured,
 * and painting it amber says the opposite. Only an empty queue is worth red
 * without a rate, because that is a fact rather than an estimate.
 */
export const callerUrgency = (uncalled: number, d: number | null): string =>
  uncalled === 0 || (d !== null && d < LEAD_URGENT_DAYS)
    ? "text-destructive"
    : d !== null && d < LEAD_LOW_DAYS
      ? "text-amber-600 dark:text-amber-500"
      : "";
