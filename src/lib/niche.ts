/**
 * Which niche a call list belongs to.
 *
 * A scrape arrives as many lists rather than one — "Junk Removal 5.1" through
 * "5.10" from a single import split ten ways, and the same trade scraped again
 * a month earlier as "2.1". They are one pool of businesses, they are worked
 * by the same script, and they run out together, so any question about how
 * much is left has to read them as one thing. Twenty-four rows saying 6% each
 * answer nothing; "Junk Removal is 48% through" is the answer.
 *
 * The rule is the trailing part number and nothing else:
 *
 *   "Junk Removal 5.10" → "Junk Removal"    (imported split, space)
 *   "Movers.2"          → "Movers"          (`partName`, dot)
 *   "Landscaping 2"     → "Landscaping"     (split by hand, before either)
 *
 * Both spellings are here because `list-name.ts` writes a dot and every list
 * split before 2026-09-07 used a space; the lists on prod use both.
 *
 * **The market suffix deliberately survives.** "Movers SG" is not "Movers" and
 * "London Junk Removal" is not "Junk Removal": different countries, different
 * businesses, different numbers to ring. Folding them together would report a
 * pile of leads as available to a floor that cannot call them, which is the
 * one way this reading can do harm — it is read to decide whether to buy more.
 *
 * Its own db-free module for the reason `list-name.ts` is one: the grouping is
 * worked out on the server and the names are read on the screen, and a second
 * copy of the rule is two answers to "which niche is this".
 */
export function nicheOf(name: string): string {
  const base = name.trim().replace(/[\s.]+\d+(?:\.\d+)*$/, "").trim();
  // A list called nothing but a number keeps its name rather than becoming the
  // empty-string niche that every other such list would also join.
  return base || name.trim();
}
