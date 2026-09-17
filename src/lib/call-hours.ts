/**
 * When a prospect may be rung: during their own opening hours where the
 * scrape gives them, and 9am to 6pm their time where it does not.
 *
 * A module of its own for the reason `lib/stats-zones.ts`, `lib/phone.ts` and
 * `components/calls/outcome.ts` are: the dialler is a client component and
 * `lib/calls.ts` imports the Postgres client, so importing a *value* from
 * there drags the driver into the browser bundle and the build fails. Types
 * are erased and safe; these are not. `calls.ts` re-exports the constants, so
 * `from "@/lib/calls"` keeps working on the server.
 *
 * One definition because several screens answer to it and they must agree:
 * the dialler filters the queue by this window, its empty state explains
 * itself in these words, the dial card's clock turns red outside it, missed
 * calls wait for it, and Stats flags a call that fell outside it. A report
 * saying a call was out of hours had better mean the same window the dialler
 * used when it handed the number over. The SQL form is `withinLeadHours` in
 * `lib/calls.ts`; `isOpenAt` below is the same rule for the browser.
 *
 * It was 9 to 5 with no exceptions until 2026-09-17. See
 * `docs/lead-hours.md`, "A business's own hours".
 */

/** The window for a lead whose hours we do not have. */
export const LEAD_HOURS_START = "09:00";
export const LEAD_HOURS_END = "18:00";
export const LEAD_HOURS_LABEL = "9am to 6pm";

/**
 * The widest a business's own hours are believed.
 *
 * "Open 24 hours" is a third of all the day entries, and on Google it usually
 * means a one-person business that listed its mobile, not somebody answering
 * at midnight. Junk King lists 4 AM. So a business's hours only ever narrow
 * the day inside these, never widen it past them.
 */
export const OPEN_HOURS_EARLIEST = "08:00";
export const OPEN_HOURS_LATEST = "20:00";

/** The whole rule in words, for screens that explain an empty queue or a flag. */
export const CALLING_HOURS_LABEL = `their opening hours (${LEAD_HOURS_LABEL} where we do not have them)`;

/** One day's opening hours: "HH:MM" pairs, the end possibly "24:00". Empty
 *  means closed. Mirrors `OpenRange` in `lib/opening-hours.mjs`. */
export type OpenRange = [string, string];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Is it calling time, `minutes` past midnight where the lead is?
 *
 * `today` is that day's ranges, or null when we do not know the business's
 * hours, which falls back to the default window. The browser twin of
 * `withinLeadHours`: change one, change both.
 */
export function isOpenAt(today: OpenRange[] | null, minutes: number): boolean {
  if (today === null) {
    return (
      minutes >= toMinutes(LEAD_HOURS_START) && minutes < toMinutes(LEAD_HOURS_END)
    );
  }
  const earliest = toMinutes(OPEN_HOURS_EARLIEST);
  const latest = toMinutes(OPEN_HOURS_LATEST);
  return today.some(
    ([open, close]) =>
      minutes >= Math.max(toMinutes(open), earliest) &&
      minutes < Math.min(toMinutes(close), latest),
  );
}
