"use client";

import * as React from "react";
import { ChevronRight, Search } from "lucide-react";
import type { ListStat } from "@/lib/call-stats";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The niches on Stats: the ones being worked, with a search box over all of them.
 *
 * The card listed every list, and at forty-one niches that is a screen and a
 * half of rows a founder scrolls past to reach anything. Thirty-two of those
 * forty-one had no calls in the last seven days — every Singapore niche, every
 * list handed out and not yet started — so they rendered as "- picked up ·
 * 0 demos" and were pure length.
 *
 * **Dormant is "no calls in the range", not "fully worked".** That distinction
 * is the whole rule and it was measured rather than assumed: five lists sit at
 * 100% worked, and two of them, Junk Removal 1.1 and 1.2, are the second and
 * third busiest niches on the floor (144 and 206 calls). Hiding by worked
 * percentage would have taken the two most active lists off the screen, which
 * is the opposite of what anybody wants from a shorter card. Nothing dialled in
 * the window is what the rows nobody wants actually have in common.
 *
 * **Search reaches everything**, dormant niches and rows past the cap included.
 * A search that cannot find Yachting SG because Yachting SG is hidden is worse
 * than no search, and it is the first thing somebody would try.
 *
 * `ListStat` is imported as a **type only**: `@/lib/call-stats` imports the
 * Postgres client, and a value taken from it here would pull the driver into
 * the browser bundle — the wall `components/calls/outcome.ts` was built to get
 * around. The rows stay native `details` for the reason they always were: they
 * need no React state and open on the first click. What this does cost, and
 * what the server-rendered version did not, is shipping the card in the bundle;
 * that is the price of the search box and it is paid once.
 */

/** Enough to cover every niche with calls in it on a normal week — there were
 *  nine the day this shipped — without the cap being the thing you notice. */
const DEFAULT_ROWS = 10;

const pct = (num: number, den: number) =>
  den === 0 ? "-" : `${((num / den) * 100).toFixed(1)}%`;

export function ListStatsRows({ lists }: { lists: ListStat[] }) {
  const [query, setQuery] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);

  // Busiest first, then how far through the niche is. Sorted here rather than
  // in the query because the order is a property of this screen, not the data:
  // `getListStats` returns newest-created first, which led the card with
  // whatever was imported or split most recently, all of it at 0%.
  const sorted = React.useMemo(
    () =>
      [...lists].sort(
        (a, b) =>
          b.calls - a.calls ||
          b.worked / (b.leads || 1) - a.worked / (a.leads || 1),
      ),
    [lists],
  );

  const q = query.trim().toLowerCase();
  const searching = q !== "";

  const matches = React.useMemo(
    () =>
      searching ? sorted.filter((l) => l.name.toLowerCase().includes(q)) : sorted,
    [sorted, searching, q],
  );

  const active = React.useMemo(() => matches.filter((l) => l.calls > 0), [matches]);

  // Searching or expanded shows the lot; otherwise the worked niches, capped.
  const shown = searching || showAll ? matches : active.slice(0, DEFAULT_ROWS);
  const hidden = matches.length - shown.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-5 py-2.5">
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2.2}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search niches"
            aria-label="Search niches"
            className="h-8 pl-8 text-[13px]"
          />
        </div>

        {/* Says what is missing and why, rather than leaving somebody to wonder
            where the rest of their niches went. The count is the whole point:
            "32 hidden" is the thing that tells you the card is filtered. */}
        {!searching && hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-[12px] font-semibold text-primary hover:underline"
          >
            Show all {matches.length} niches
            <span className="ml-1 font-normal text-muted-foreground">
              ({hidden} with no calls in this range
              {!showAll && active.length > DEFAULT_ROWS
                ? " or below the top ten"
                : ""}
              )
            </span>
          </button>
        )}
        {!searching && showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-[12px] font-semibold text-primary hover:underline"
          >
            Show fewer
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
          {searching ? (
            <>
              No niche matches &ldquo;{query.trim()}&rdquo;.{" "}
              <button
                type="button"
                onClick={() => setQuery("")}
                className="font-semibold text-primary hover:underline"
              >
                Clear the search
              </button>
            </>
          ) : (
            <>
              Nothing was dialled in any niche in this range.{" "}
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="font-semibold text-primary hover:underline"
              >
                Show all {matches.length} anyway
              </button>
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {shown.map((l) => {
            const workedPct =
              l.leads > 0 ? Math.round((l.worked / l.leads) * 100) : 0;
            return (
              <li key={l.id}>
                {/* Three numbers on the row and the rest behind a fold. Worked,
                    pickup rate and demos are the only ones anybody acts on;
                    leads, calls, trials and wins are what you go looking for
                    once one of those three looks wrong. */}
                <details className="group">
                  {/* Wraps to two lines on a phone. The three figures are fixed
                      width and, with the chevron and the padding, take about
                      346px of a 390px screen — which left the name squeezed to
                      nothing by its own `truncate`, so every row read "0%
                      worked · - picked up · 0 demos" with no niche on it.
                      `basis-full` gives the name the first line to itself until
                      `sm`. Caught by screenshotting at 390: `innerText` still
                      had the name in it, so the DOM said it was fine. */}
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                    <span className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-auto">
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                      <span className="min-w-0 truncate text-[13px] font-semibold">
                        {l.name}
                      </span>
                    </span>

                    {/* Decoration over the percentage printed beside it, so it
                        is not announced twice. */}
                    <span
                      aria-hidden
                      className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted sm:block"
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${workedPct}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right text-[12px] tabular-nums">
                      {workedPct}
                      <span className="ml-1 text-muted-foreground">
                        % worked
                      </span>
                    </span>

                    <span className="w-24 shrink-0 text-right text-[12px] tabular-nums">
                      {pct(l.pickups, l.calls)}
                      <span className="ml-1 text-muted-foreground">
                        picked up
                      </span>
                    </span>

                    <span
                      className={cn(
                        "w-20 shrink-0 text-right text-[12px] tabular-nums",
                        l.demos === 0 && "text-muted-foreground",
                      )}
                    >
                      {l.demos}
                      <span className="ml-1 text-muted-foreground">
                        {l.demos === 1 ? "demo" : "demos"}
                      </span>
                    </span>
                  </summary>

                  <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 pb-2.5 pl-[3.25rem] text-[12px] tabular-nums text-muted-foreground">
                    <span>
                      {l.worked.toLocaleString()} of{" "}
                      {l.leads.toLocaleString()} leads rung
                    </span>
                    <span>{l.calls.toLocaleString()} calls</span>
                    <span>{l.pickups.toLocaleString()} pickups</span>
                    <span>{l.trials.toLocaleString()} trials</span>
                    <span>{l.won.toLocaleString()} won</span>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
