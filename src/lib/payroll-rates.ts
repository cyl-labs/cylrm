/**
 * What the floor is paid, and the arithmetic on it.
 *
 * In a module with no database import, for the reason `components/calls/
 * outcome.ts` and `lib/phone.ts` exist: `@/lib/payroll` pulls in the Postgres
 * client, so a client component importing a *value* from it drags the driver
 * into the browser bundle and the build fails. The mark-as-paid dialog needs
 * to render amounts, so the amounts live here and `@/lib/payroll` re-exports
 * them — one place to change a rate, reachable from both sides.
 *
 * Dates deliberately are *not* here. Every date on the Payroll screen is
 * formatted on the server and passed down as a string, so the reporting
 * timezone stays in one file and there is no chance of the server and the
 * browser disagreeing about what day something happened on.
 */

export const PICKUPS_PER_BONUS = 50;
/** Paid for every whole 50 pickups. Was $20 until 2026-08-28. Changing it
 *  changes what accrues from now on and nothing already recorded: every payout
 *  row carries the rates that were in force when it was written. */
export const PICKUP_BONUS_CENTS = 1_000;
/** $30 per meeting the prospect turned up to. */
export const MEETING_CENTS = 3_000;

/**
 * Whole dollars where they are whole, which at these rates they always are.
 * The cents exist so that an odd rate later cannot round money away.
 */
export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

/** No rollover: 130 pickups is two bonuses, and the 30 are not carried. */
export const pickupBonusCents = (pickups: number) =>
  Math.floor(pickups / PICKUPS_PER_BONUS) * PICKUP_BONUS_CENTS;

/**
 * Pickups counted but not yet worth another bonus.
 *
 * Marking paid discards these, which is what "no rollover of partial progress"
 * means. The confirmation says the number out loud rather than letting a
 * caller's 40 pickups vanish unremarked.
 */
export const pickupsTowardNext = (pickups: number) =>
  pickups % PICKUPS_PER_BONUS;
