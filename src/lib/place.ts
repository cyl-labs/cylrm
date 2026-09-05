/**
 * Where a lead is, as one line of text.
 *
 * Its own module rather than living in `lib/calls.ts`, for the reason
 * `website.ts`, `phone.ts`, `call-hours.ts` and `outcome.ts` are: the dial card
 * and the pipeline board are client components, and `lib/calls.ts` imports the
 * Postgres client. One home so the queue, the dial card and the board cannot
 * drift into describing the same lead three ways.
 *
 * Both fields are optional and often absent — see `QueueLead.state`. Nothing
 * here invents a place from the phone number.
 */

export type Placed = { city?: string | null; state?: string | null };

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
};

/**
 * "Brooklyn, New York" — the full version, for a card with room.
 *
 * Falls back to whichever half exists, and returns null when neither does so
 * callers can drop the element entirely rather than render an empty line.
 * A city equal to its state ("New York, New York" from a scrape that filled
 * both the same) collapses to one, because printing it twice reads as a bug.
 */
export function placeLabel(lead: Placed): string | null {
  const city = clean(lead.city);
  const state = clean(lead.state);
  if (city && state) {
    return city.toLowerCase() === state.toLowerCase() ? state : `${city}, ${state}`;
  }
  return state ?? city;
}

/**
 * The shortest honest version, for a row with one line to spare.
 *
 * The state, because that is what a caller needs to not sound like they are
 * reading a list — the city is detail they will get from the prospect anyway.
 * Falls back to the city when that is all there is.
 */
export function placeShort(lead: Placed): string | null {
  return clean(lead.state) ?? clean(lead.city);
}
