/**
 * Business hours where the prospect is: 9am to 5pm, their local time.
 *
 * A module of its own for the reason `lib/stats-zones.ts`, `lib/phone.ts` and
 * `components/calls/outcome.ts` are: the dialler is a client component and
 * `lib/calls.ts` imports the Postgres client, so importing a *value* from
 * there drags the driver into the browser bundle and the build fails. Types
 * are erased and safe; these are not. `calls.ts` re-exports all three, so
 * `from "@/lib/calls"` keeps working on the server.
 *
 * One definition because three screens answer to it and they must agree: the
 * dialler filters the queue by this window, its empty state explains itself in
 * these words, and Stats flags a call that fell outside it. A report saying a
 * call was out of hours had better mean the same window the dialler used when
 * it handed the number over.
 *
 * The machine-readable pair is what goes into SQL; the label is the same
 * window as a person would say it, kept beside them so a screen cannot claim
 * one window while the query applies another.
 */
export const LEAD_HOURS_START = "09:00";
export const LEAD_HOURS_END = "17:00";
export const LEAD_HOURS_LABEL = "9am to 5pm";
