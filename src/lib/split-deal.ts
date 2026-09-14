/**
 * How a list's leads are divided when it is split between callers.
 *
 * Database-free, because the split dialog previews the sizes in the browser and
 * the route deals the leads on the server — and a preview following a second
 * copy of the rule is one that can quietly stop matching what gets written.
 */

/** Equal parts, the remainder going to the first ones. What a split does unless
 *  somebody moves the slider. */
export function evenShares(total: number, parts: number): number[] {
  return Array.from(
    { length: parts },
    (_, i) => Math.floor(total / parts) + (i < total % parts ? 1 : 0),
  );
}

/**
 * Which part each lead goes to, in list order, for any sizes.
 *
 * Still dealt, never cut into blocks: a scrape arrives sorted by city or
 * rating, so contiguous slices hand one caller every Alaska lead. Each lead
 * goes to the part furthest behind its target share at that point in the list,
 * so a part asked to take 60% gets three leads in every five all the way down
 * rather than the first 60% of the file.
 *
 * With equal sizes this is exactly the `i % parts` round robin the split used
 * before sizes could be chosen, remainder included — ties go to the earlier
 * part — so an untouched slider deals the same way it always has.
 */
export function dealParts(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const given = sizes.map(() => 0);
  const order: number[] = [];
  for (let k = 0; k < total; k++) {
    let pick = -1;
    let bestGap = -Infinity;
    for (let p = 0; p < sizes.length; p++) {
      if (given[p] >= sizes[p]) continue;
      const gap = (sizes[p] * (k + 1)) / total - given[p];
      if (gap > bestGap + 1e-9) {
        pick = p;
        bestGap = gap;
      }
    }
    given[pick] += 1;
    order.push(pick);
  }
  return order;
}
