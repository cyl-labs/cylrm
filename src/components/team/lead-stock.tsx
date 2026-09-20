import Link from "next/link";
import { Layers } from "lucide-react";
import type { NicheStock } from "@/lib/lead-stock";
import { cn } from "@/lib/utils";

/**
 * Are we running out of leads?
 *
 * The Call lists column on the table above answers it one caller at a time,
 * which is the wrong shape for the decision it feeds: leads are bought a niche
 * at a time, twenty-four lists of Junk Removal are one pile, and a scrape
 * takes days to arrive. So this reads the same numbers the other way up — one
 * row a niche, soonest to empty first — and says out loud how long each has
 * left at the rate the floor has actually been getting through them.
 *
 * Founders only, like the rest of this screen. A caller cannot assign a list,
 * and telling somebody their work runs out on Thursday when they cannot do
 * anything about it is not information, it is a worry.
 *
 * A server component: the only thing that opens is a native `details`, so it
 * costs no state and works before hydration — the same reason the "By list"
 * fold on Stats is native.
 */

const n = (v: number) => v.toLocaleString("en-US");

/**
 * How long a niche has left, in words.
 *
 * Words rather than "8.1", for the reason the Team table says "3 days" rather
 * than a join date: this is read to decide whether to order more leads this
 * week, and a decimal invites arithmetic nobody wants to do. Never rounded
 * down to zero — "0 days" reads as a broken number where "under a day" reads
 * as the thing it is.
 *
 * Every phrase has to read after "in" as well as under "Runs out in", which is
 * why none of them is a bare number.
 */
function whenOut(d: number): string {
  if (d < 1) return "under a day";
  if (d < 1.5) return "about a day";
  if (d < 21) return `about ${Math.round(d)} days`;
  if (d < 70) return `about ${Math.round(d / 7)} weeks`;
  return "months";
}

/** Under a week left is the point at which ordering more has to start, since
 *  a scrape is not same-day. Ten days is the nudge before it. */
const urgency = (d: number | null) =>
  d === null ? "" : d < 7 ? "text-destructive" : d < 10 ? "text-amber-600 dark:text-amber-500" : "";

function Bar({ fraction }: { fraction: number }) {
  return (
    <span
      aria-hidden
      className="block h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-foreground/10"
    >
      <span
        className="block h-full rounded-full bg-primary"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </span>
  );
}

function Rows({
  rows,
  idle = false,
}: {
  rows: NicheStock[];
  /** Inside the fold, where every row is a niche nobody is calling. The last
   *  two columns then say the same thing eleven times over, so they are left
   *  as a dash and the heading above carries the reason. */
  idle?: boolean;
}) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b text-left">
          {["Niche", "How far through", "Never rung", "Waiting for a caller", "Runs out in"].map(
            (h) => (
              <th
                key={h}
                className="whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"
              >
                {h}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.niche} className="border-b last:border-0">
            <td className="px-4 py-2.5">
              {/* Nowrap, so a two-word niche keeps its line and the table
                  scrolls instead — a name broken as "Junk / Removal" reads as
                  two niches at 390px. */}
              <p className="whitespace-nowrap font-semibold">{r.niche}</p>
              <p
                className="whitespace-nowrap text-[12px] text-muted-foreground"
                title={r.callers.length > 0 ? r.callers.join(", ") : undefined}
              >
                {r.lists} list{r.lists === 1 ? "" : "s"}
                {r.callers.length > 0
                  ? ` · ${r.callers.length} caller${r.callers.length === 1 ? "" : "s"}`
                  : " · nobody on it"}
              </p>
            </td>
            <td className="min-w-40 px-4 py-2.5">
              {r.total === 0 ? (
                <p className="whitespace-nowrap text-[12px] text-muted-foreground">
                  Nothing imported yet
                </p>
              ) : (
                <>
                  <Bar fraction={r.fraction} />
                  <p className="mt-1 whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {Math.round(r.fraction * 100)}%
                    </span>{" "}
                    · {n(r.done)} of {n(r.total)} done
                  </p>
                </>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">
              {/* A niche with no leads at all is not out of new ones, it is
                  empty — saying "0, none left to dial" in red sends somebody
                  looking for work that was never imported. */}
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  r.total > 0 && r.uncalled === 0 && "text-destructive",
                )}
              >
                {r.total === 0 ? "—" : n(r.uncalled)}
              </span>
              <p className="text-[12px] text-muted-foreground">
                {r.total === 0
                  ? "no leads on it"
                  : r.uncalled === 0
                    ? "none left to dial"
                    : "never dialled"}
              </p>
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">
              {r.spare > 0 ? (
                <>
                  <span className="font-semibold tabular-nums">{n(r.spare)}</span>
                  <p className="text-[12px] text-muted-foreground">
                    on {r.spareLists} list{r.spareLists === 1 ? "" : "s"} to hand out
                  </p>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">
              {r.daysLeft === null ? (
                <>
                  <span className="text-muted-foreground">—</span>
                  {!idle && (
                    <p className="text-[12px] text-muted-foreground">
                      nobody calling it
                    </p>
                  )}
                </>
              ) : (
                <>
                  <span className={cn("font-semibold", urgency(r.daysLeft))}>
                    {whenOut(r.daysLeft)}
                  </span>
                  <p className="text-[12px] tabular-nums text-muted-foreground">
                    {n(Math.round(r.perDay))} new leads a day
                  </p>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LeadStock({
  rows,
  className,
}: {
  rows: NicheStock[];
  className?: string;
}) {
  // Being called, and so running out of something. The rest is reserve.
  const working = rows.filter((r) => r.daysLeft !== null);
  const idle = rows.filter((r) => r.daysLeft === null);
  const reserve = idle.reduce((sum, r) => sum + r.uncalled, 0);
  const soonest = working[0] ?? null;

  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-extrabold tracking-[-0.01em]">
          <Layers className="size-4 text-muted-foreground" strokeWidth={2.2} />
          Are we running out of leads?
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Lists with the same name are one niche, so Junk Removal 5.1, 5.2 and
          2.1 are all Junk Removal. What runs out is leads nobody has rung yet:
          a second try is work, but only a fresh one is a business you have not
          spoken to. Order the next scrape before a niche is inside a week.
        </p>
        {soonest && (
          <p className="mt-2 text-[13px]">
            <span className={cn("font-semibold", urgency(soonest.daysLeft))}>
              {soonest.niche} runs out of new leads in{" "}
              {whenOut(soonest.daysLeft!)}
            </span>
            {soonest.spare > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · {n(soonest.spare)} of them still waiting for a caller
              </span>
            )}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">
          No call lists yet.{" "}
          <Link href="/calls" className="font-semibold underline-offset-4 hover:underline">
            Import one on Call lists
          </Link>
          .
        </p>
      ) : (
        <>
          {working.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-muted-foreground">
              Nothing was rung this past week, so nothing is running out. Every
              niche below is waiting to be handed out.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Rows rows={working} />
            </div>
          )}

          {idle.length > 0 && (
            <details className="border-t group">
              <summary className="cursor-pointer list-none px-4 py-2.5 text-[13px] font-semibold marker:content-none hover:bg-muted/50">
                <span className="text-muted-foreground group-open:hidden">Show </span>
                {idle.length} niche{idle.length === 1 ? "" : "s"} nobody is
                calling
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {n(reserve)} leads never rung, ready to hand out
                </span>
              </summary>
              <div className="overflow-x-auto border-t">
                <Rows rows={idle} idle />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
