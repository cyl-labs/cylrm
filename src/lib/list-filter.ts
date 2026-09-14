import {
  DEFAULT_LIST_SORT,
  isListSort,
  listProgress,
  type ListSort,
} from "@/lib/list-sort";

/**
 * The founders' filters on the Call lists screen.
 *
 * Database-free for the reason `lib/list-sort.ts` is: the page filters on the
 * server and the filter bar is a client component that builds the same links,
 * and two copies of "what counts as not started" would be two answers.
 *
 * Every choice lives in the URL, so a refresh keeps it and a link shows what
 * its sender was looking at. The bar rebuilds the whole query string on every
 * change — the trap Stats documents, where a control that set only its own
 * parameter quietly dropped the others.
 *
 * Built on 2026-09-15, when the floor had 41 lists and 31 of them belonged to
 * nobody: the question a founder brings to this screen is usually "what is
 * still to hand out" or "how far has this person got", and a grid sorted by
 * name answered neither.
 */

export type ListStage = "all" | "not-started" | "in-progress" | "finished";

export const LIST_STAGES: { value: ListStage; label: string }[] = [
  { value: "all", label: "Any progress" },
  { value: "not-started", label: "Not started" },
  { value: "in-progress", label: "In progress" },
  { value: "finished", label: "Finished" },
];

export type ListMarket = "any" | "sg" | "us" | "gb" | "unfiled";

/** Whose lists: anybody, the reader's own, nobody's, or one person's. */
export type ListOwner = "any" | "me" | "none" | number;

export type ListFilters = {
  q: string;
  owner: ListOwner;
  market: ListMarket;
  stage: ListStage;
  sort: ListSort;
};

export const NO_LIST_FILTERS: ListFilters = {
  q: "",
  owner: "any",
  market: "any",
  stage: "all",
  sort: DEFAULT_LIST_SORT,
};

export function parseListFilters(params: {
  q?: string;
  owner?: string;
  market?: string;
  stage?: string;
  sort?: string;
  /** The old Mine/Everyone toggle, so a bookmark of it still works. */
  mine?: string;
}): ListFilters {
  const ownerParam = params.owner ?? (params.mine === "1" ? "me" : undefined);
  const owner: ListOwner =
    ownerParam === "me" || ownerParam === "none"
      ? ownerParam
      : ownerParam && /^\d+$/.test(ownerParam)
        ? Number(ownerParam)
        : "any";
  const market = ["sg", "us", "gb", "unfiled"].includes(params.market ?? "")
    ? (params.market as ListMarket)
    : "any";
  const stage = LIST_STAGES.some((s) => s.value === params.stage)
    ? (params.stage as ListStage)
    : "all";
  return {
    q: (params.q ?? "").trim().slice(0, 80),
    owner,
    market,
    stage,
    sort: isListSort(params.sort) ? params.sort : DEFAULT_LIST_SORT,
  };
}

/** The query string for a set of filters, defaults left out so an unfiltered
 *  screen is plain `/calls`. Includes the leading "?" when there is one. */
export function listFilterQuery(f: ListFilters): string {
  const q = new URLSearchParams();
  if (f.q) q.set("q", f.q);
  if (f.owner !== "any") q.set("owner", String(f.owner));
  if (f.market !== "any") q.set("market", f.market);
  if (f.stage !== "all") q.set("stage", f.stage);
  if (f.sort !== DEFAULT_LIST_SORT) q.set("sort", f.sort);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Anything narrowing the lists, as opposed to only ordering them. */
export const isFiltered = (f: ListFilters) =>
  f.q !== "" || f.owner !== "any" || f.market !== "any" || f.stage !== "all";

type Filterable = {
  name: string;
  niche: string | null;
  assignedUserId: number | null;
  assignedName: string | null;
  region: string | null;
  total: number;
  uncalled: number;
  toRetry: number;
  callbacksDue: number;
};

/**
 * Which stage a list is at.
 *
 * "Not started" is nobody has rung a single lead, not "nothing is done": a
 * list where every lead has been rung once and gone to voicemail has nothing
 * done and is plainly under way. "Finished" is the card's own bar at full —
 * `listProgress`, so the filter and the bar cannot disagree.
 */
export function stageOf(l: Filterable): Exclude<ListStage, "all"> | null {
  if (l.total === 0) return null;
  if (l.uncalled === l.total) return "not-started";
  return listProgress(l).leftToCall === 0 ? "finished" : "in-progress";
}

export function applyListFilters<T extends Filterable>(
  lists: T[],
  f: ListFilters,
  meId: number | null,
): T[] {
  const q = f.q.toLowerCase();
  return lists.filter((l) => {
    if (f.owner === "me" && l.assignedUserId !== meId) return false;
    if (f.owner === "none" && l.assignedUserId !== null) return false;
    if (typeof f.owner === "number" && l.assignedUserId !== f.owner) return false;
    if (f.market === "unfiled" && l.region !== null) return false;
    if (f.market !== "any" && f.market !== "unfiled" && l.region !== f.market) {
      return false;
    }
    if (f.stage !== "all" && stageOf(l) !== f.stage) return false;
    if (
      q &&
      ![l.name, l.niche, l.assignedName].some((v) => v?.toLowerCase().includes(q))
    ) {
      return false;
    }
    return true;
  });
}
