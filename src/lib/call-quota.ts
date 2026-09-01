/**
 * The weekly calling quota, and the arithmetic on it.
 *
 * In a module with no database import, for the reason `lib/payroll-rates.ts`
 * and `lib/call-hours.ts` exist: `@/lib/calls` and `@/lib/call-stats` pull in
 * the Postgres client, and the progress bar renders in the app shell on every
 * screen. One place to change the number, reachable from both sides.
 *
 * A week, not a day, and it starts Monday: the same week `payout.week_start`
 * uses, so a caller's quota week and their pay week are the same seven days.
 * Two different weeks on two screens is the confusion this avoids.
 */

/** Calls logged, per person, per week. Attempts, not leads, and not pickups:
 *  it is a measure of work done rather than of luck, which is the only kind of
 *  target a caller can actually hit on purpose. */
export const WEEKLY_CALL_QUOTA = 300;

/**
 * How far through the quota, capped at 1 for the bar's width only.
 *
 * The *number* is never capped. Someone who rings 340 is shown 340: the bar
 * filling up is not permission to stop, and a counter that froze at 300 would
 * quietly tell the best caller on the floor that their last forty did not
 * count.
 */
export const quotaFraction = (calls: number, quota = WEEKLY_CALL_QUOTA) =>
  quota <= 0 ? 1 : Math.min(1, calls / quota);

/** Calls still owed this week, or zero once the quota is met. */
export const callsRemaining = (calls: number, quota = WEEKLY_CALL_QUOTA) =>
  Math.max(0, quota - calls);
