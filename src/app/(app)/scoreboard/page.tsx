import { Trophy } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { RangeTabs } from "@/components/calls/range-tabs";
import { getCurrentUser } from "@/lib/session";
import {
  getPersonStats,
  todayInCallTz,
  type StatsWindow,
} from "@/lib/call-stats";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
] as const;

function windowFor(range: string): StatsWindow {
  if (range === "today") return { kind: "day", date: todayInCallTz() };
  return { kind: "rolling", days: Number(range) };
}

const pct = (num: number, den: number) =>
  den === 0 ? "-" : `${Math.round((num / den) * 100)}%`;

/**
 * The floor's numbers, for the floor.
 *
 * Deliberately not the admin Stats screen, which is a different job: that one
 * is for working out whether the operation is healthy, this one is for a
 * caller to see where they stand before lunch. Everyone's figures, not just
 * your own, because that is the point — and because a leaderboard nobody else
 * appears on is just your own dashboard.
 *
 * Open to callers, unlike `/call-stats`. What is shown is the same thing every
 * person on it already knows about their own day, so there is nothing here to
 * keep from the people doing the work.
 */
export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: raw } = await searchParams;
  const range = RANGES.some((r) => r.key === raw) ? raw! : "today";

  const me = await getCurrentUser();
  const all = await getPersonStats(windowFor(range));

  // Calls made before staff logins existed belong to nobody, and "Not
  // attributed" is not a competitor.
  const people = all
    .filter((p) => p.id !== null)
    .sort((a, b) => b.demos - a.demos || b.calls - a.calls);

  const mine = people.find((p) => p.id === me?.id);
  const myRank = mine ? people.indexOf(mine) + 1 : null;

  return (
    <PageShell title="Scoreboard" actions={<RangeTabs ranges={RANGES} active={range} />}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
        {/* Your own row first and large. Everything below is context for it. */}
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
              You
            </p>
            {myRank && people.length > 1 && (
              <p className="text-[13px] font-semibold text-muted-foreground">
                {myRank === 1 ? "Top of the board" : `#${myRank} of ${people.length}`}
              </p>
            )}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {[
              { label: "Calls", value: mine?.calls ?? 0 },
              { label: "Pickups", value: mine?.pickups ?? 0 },
              { label: "Demos", value: mine?.demos ?? 0 },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
                  {s.value.toLocaleString()}
                </p>
                <p className="text-[13px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          {(mine?.calls ?? 0) === 0 && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Nothing logged yet {range === "today" ? "today" : "in this range"}.
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Trophy className="size-4 text-muted-foreground" strokeWidth={2.2} />
            <p className="text-sm font-extrabold tracking-[-0.01em]">Everyone</p>
            <p className="ml-auto text-[12px] text-muted-foreground">
              Ranked by demos, then calls
            </p>
          </div>
          {people.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              No calls logged {range === "today" ? "today" : "in this range"} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left">
                    {["", "Person", "Calls", "Pickups", "Demos"].map((h, i) => (
                      <th
                        key={h || "rank"}
                        className={cn(
                          "whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                          i > 1 && "text-right",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => {
                    const isMe = p.id === me?.id;
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          "border-b last:border-0",
                          isMe && "bg-primary/[0.06]",
                        )}
                      >
                        <td className="w-10 px-4 py-2.5 tabular-nums text-muted-foreground">
                          {i + 1}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold">
                          {p.name}
                          {isMe && (
                            <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                              you
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {p.calls.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {pct(p.pickups, p.calls)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                          {p.demos.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
