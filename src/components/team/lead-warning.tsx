import { TriangleAlert } from "lucide-react";
import type { PoolList, ShortCaller } from "@/lib/lead-stock";
import { callerUrgency, whenOut } from "@/lib/lead-words";
import { AssignListMenu } from "@/components/team/assign-list";
import { cn } from "@/lib/utils";

const n = (v: number) => v.toLocaleString("en-US");

/**
 * Who is about to have nothing to ring, at the top of the screen.
 *
 * The niche table at the bottom says the floor has nine days of Junk Removal
 * left, which is true and is not the same as knowing that Aaron personally
 * runs out this afternoon — his share of it can empty while the pile is still
 * deep. This is the per-person reading, put above everything else because it
 * is the only thing on Team that is time-critical: a caller who runs dry at
 * eleven sits there until somebody notices.
 *
 * It renders nothing when nobody is short, which is the normal state. A panel
 * that is always present is one that stops being read.
 *
 * A server component holding one client control: nothing here has state, and
 * the assign menu brings its own.
 */
export function LeadWarning({
  callers,
  pool,
  className,
}: {
  callers: ShortCaller[];
  /** Everything nobody is on — what there is to hand out, and whether there is
   *  anything at all. */
  pool: PoolList[];
  className?: string;
}) {
  if (callers.length === 0) return null;

  // Red the moment somebody has nothing new left; amber while it is still a
  // warning about tomorrow.
  const out = callers.filter((c) => c.uncalled === 0);
  const red = out.length > 0;
  const spare = pool.reduce((sum, l) => sum + l.uncalled, 0);

  return (
    <div
      className={cn(
        "overflow-hidden",
        red
          ? "border-destructive/40 bg-destructive/5"
          : "border-amber-500/40 bg-amber-500/5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2.5">
        <TriangleAlert
          className={cn("size-4 shrink-0", red ? "text-destructive" : "text-amber-600 dark:text-amber-500")}
          strokeWidth={2.2}
        />
        <p className="text-sm font-extrabold tracking-[-0.01em]">
          {callers.length === 1
            ? `${callers[0].name} is ${callers[0].uncalled === 0 ? "out of new leads" : "nearly out of new leads"}`
            : `${callers.length} callers are running out of new leads`}
        </p>
        <p className="w-full text-[13px] text-muted-foreground sm:w-auto">
          Give them one of the lists nobody is on, and they keep dialling.
        </p>
      </div>

      <ul className="divide-y">
        {callers.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13px]"
          >
            <span className="font-bold">{c.name}</span>
            <span className={cn("font-semibold", callerUrgency(c.uncalled, c.daysLeft))}>
              {c.listNames.length === 0
                ? "no lists at all — their screen is empty"
                : c.uncalled === 0
                  ? "nothing new left to dial"
                  : `${n(c.uncalled)} never rung · ${whenOut(c.daysLeft!)} left`}
            </span>
            {c.perDay > 0 && (
              <span className="text-muted-foreground">
                rings {n(Math.round(c.perDay))} new a day
              </span>
            )}
            <AssignListMenu
              className="ml-auto"
              person={{ id: c.id, name: c.name }}
              pool={pool}
              theirLists={c.listNames}
              market={c.market}
            />
          </li>
        ))}
      </ul>

      <p className="border-t px-4 py-2 text-[12px] text-muted-foreground">
        {pool.length === 0 ? (
          <span className="font-semibold text-destructive">
            Every list already belongs to somebody — there is nothing to hand
            out. The next scrape needs ordering.
          </span>
        ) : (
          <>
            {pool.length} list{pool.length === 1 ? "" : "s"} nobody is on,{" "}
            {n(spare)} lead{spare === 1 ? "" : "s"} never rung between them.
          </>
        )}
      </p>
    </div>
  );
}
