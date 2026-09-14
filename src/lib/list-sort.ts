/**
 * The order the Call lists screen shows lists in.
 *
 * Database-free, because the page sorts on the server and the picker is a
 * client component that needs the same options — a second copy of the labels
 * is how the two drift apart.
 *
 * Until 2026-09-14 there was one order, newest first, straight off the query.
 * That put every freshly split part and every new import at the top and
 * scattered one niche's parts across the grid: "Junk Removal 1.5" beside the
 * test line, 1.2 three rows below 3.2. Niche is the default now because it
 * keeps a niche's parts together and in number order, which is how they are
 * talked about.
 */
export type ListSort = "niche" | "most-done" | "least-done" | "newest";

export const LIST_SORTS: { value: ListSort; label: string }[] = [
  { value: "niche", label: "Niche, A to Z" },
  { value: "most-done", label: "Most done first" },
  { value: "least-done", label: "Least done first" },
  { value: "newest", label: "Newest first" },
];

export const DEFAULT_LIST_SORT: ListSort = "niche";

export const isListSort = (v: unknown): v is ListSort =>
  LIST_SORTS.some((s) => s.value === v);

type Progressable = {
  total: number;
  uncalled: number;
  toRetry: number;
  callbacksDue: number;
};

/**
 * How far through a list is, exactly as its card's bar draws it.
 *
 * The bar tracks the queue emptying, not leads touched once: a lead rung and
 * not reached is still work. Shared with the card so "most done first" sorts on
 * the number the reader can see rather than a near relation of it.
 */
export function listProgress(l: Progressable) {
  const leftToCall = l.uncalled + l.toRetry + l.callbacksDue;
  const done = l.total - leftToCall;
  return { leftToCall, done, fraction: l.total === 0 ? 0 : done / l.total };
}

/** Numbers compared as numbers, so "Junk Removal 1.2" comes before
 *  "Junk Removal 1.10" — a plain string sort gets that backwards. */
const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * The lists in the chosen order.
 *
 * `newest` is the order they already arrive in: `getCallLists` returns newest
 * first. Progress ties fall back to niche order, so a floor full of untouched
 * lists still reads sensibly rather than arbitrarily.
 */
export function sortLists<
  T extends Progressable & { name: string; niche: string | null },
>(lists: T[], sort: ListSort): T[] {
  if (sort === "newest") return lists;
  const named = (a: T, b: T) =>
    byName.compare(a.niche || a.name, b.niche || b.name) ||
    byName.compare(a.name, b.name);
  return [...lists].sort((a, b) => {
    if (sort === "niche") return named(a, b);
    const diff = listProgress(a).fraction - listProgress(b).fraction;
    return (sort === "most-done" ? -diff : diff) || named(a, b);
  });
}
