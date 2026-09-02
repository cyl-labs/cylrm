import { Crown, Medal, Trophy } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { RangeTabs } from "@/components/calls/range-tabs";
import { getCurrentUser } from "@/lib/session";
import { listTeam } from "@/lib/users";
import {
  dayBackInStatsTz,
  getPersonStats,
  isStatsDate,
  statsZone,
  todayInStatsTz,
  type StatsWindow,
} from "@/lib/call-stats";
import { DEFAULT_STATS_REGION, isStatsRegion } from "@/lib/stats-zones";
import { TimezonePicker } from "@/components/calls/timezone-picker";
import { statsRegionOf } from "@/lib/users";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "today", label: "Today" },
  // Yesterday earns a named tab where no other single day does: it is the one
  // everybody asks for, every morning, about the shift that just finished.
  // Any other day is the arrows or the custom dialog.
  { key: "yesterday", label: "Yesterday" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
] as const;

/** The zone rides on the window, so "today" is the day the reader is in
 *  rather than always New York's. A rolling window has no zone to read — N
 *  days back from this moment is the same instant everywhere — but it carries
 *  one anyway, since nothing else has to know which kind it was handed. */
function windowFor(
  range: string,
  day: string | undefined,
  tz: string,
): StatsWindow {
  // A day and a range answer the same question two ways, and the day wins:
  // it is the more specific thing, and only one is ever written at a time.
  if (day) return { kind: "day", date: day, tz };
  if (range === "today") return { kind: "day", date: todayInStatsTz(tz), tz };
  if (range === "yesterday")
    return { kind: "day", date: dayBackInStatsTz(1, tz), tz };
  return { kind: "rolling", days: Number(range), tz };
}

/** The date a named range resolves to, or null when it is not one day. Only a
 *  single-day window has a day to step, so this is what turns the arrows on. */
function dayOf(range: string, tz: string): string | null {
  if (range === "today") return todayInStatsTz(tz);
  if (range === "yesterday") return dayBackInStatsTz(1, tz);
  return null;
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

/**
 * One colour, three strengths.
 *
 * Gold and silver were a second palette bolted onto a screen that already has
 * one. Ranking by saturation instead leaves the winner as the only block in
 * full colour, which says first place more plainly than a medal colour does,
 * and every label stays legible because the pale blocks take dark text rather
 * than white on a tint.
 */
const PLACES = [
  {
    block: "bg-primary text-primary-foreground",
    medal: "bg-primary text-primary-foreground",
    height: "h-40 sm:h-52",
    label: "1st",
  },
  {
    block: "bg-primary/25 text-foreground",
    medal: "bg-primary/30 text-primary",
    height: "h-28 sm:h-36",
    label: "2nd",
  },
  {
    block: "bg-primary/12 text-foreground",
    medal: "bg-primary/20 text-primary",
    height: "h-20 sm:h-28",
    label: "3rd",
  },
] as const;

/**
 * The top three, on a podium.
 *
 * Rendered 2, 1, 3 across so the winner is in the middle and tallest, which
 * is the only arrangement that reads as a podium rather than a chart. A list
 * sorted by demos already told you who was ahead; this is meant to be worth
 * being on.
 *
 * Degrades to two blocks or one on a quiet day rather than inventing empty
 * plinths for people who do not exist.
 */
function Podium({
  people,
  meId,
  showNumbers,
}: {
  people: { id: number | null; name: string; calls: number; demos: number }[];
  /** Whether anybody's figures are shown. Callers see the ranking and their own
   *  numbers; everyone else's belong to the founders, the same line `/call-stats`
   *  already draws. */
  showNumbers: boolean;
  meId?: number;
}) {
  const top = people.slice(0, 3);
  // Visual order, not ranking order: second, first, third.
  const arrangement = [1, 0, 2].filter((i) => top[i] !== undefined);

  return (
    <div className="rounded-xl border bg-card px-3 pt-5 pb-0 sm:px-6">
      <div className="flex items-end justify-center gap-2 sm:gap-4">
        {arrangement.map((i) => {
          const person = top[i];
          const place = PLACES[i];
          const isMe = person.id === meId;
          return (
            <div
              key={person.id}
              className="flex min-w-0 flex-1 flex-col items-center sm:max-w-52"
            >
              {/* Above the plate rather than straddling the join: a medal
                  centred on the seam sits squarely on top of the name, and
                  the names are the point. */}
              <span
                className={cn(
                  "mb-1.5 grid size-9 place-items-center rounded-full shadow-sm",
                  place.medal,
                )}
                aria-hidden
              >
                {i === 0 ? (
                  <Crown className="size-5" strokeWidth={2.6} />
                ) : (
                  <Medal className="size-4" strokeWidth={2.6} />
                )}
              </span>

              <p
                className={cn(
                  "w-full truncate rounded-t-lg px-2 py-1.5 text-center text-[13px] font-extrabold tracking-[-0.01em] sm:text-sm",
                  isMe
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
                title={person.name}
              >
                {person.name}
              </p>

              <div
                className={cn(
                  "relative flex w-full flex-col items-center justify-center rounded-b-lg pb-5",
                  place.block,
                  place.height,
                  isMe && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                )}
              >
                {showNumbers ? (
                  <p className="text-2xl font-extrabold tabular-nums leading-none sm:text-3xl">
                    {person.demos}
                  </p>
                ) : (
                  // The place, where the count would be. A podium without a
                  // number is still a podium — first, second and third is the
                  // whole point of standing on one.
                  <p className="text-2xl font-extrabold leading-none sm:text-3xl">
                    {place.label}
                  </p>
                )}
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] opacity-80">
                  {showNumbers ? (person.demos === 1 ? "demo" : "demos") : "place"}
                </p>
                {showNumbers && (
                  <p className="mt-1 text-[11px] tabular-nums opacity-70">
                    {person.calls.toLocaleString()} calls
                  </p>
                )}

                {/* Only when a number is standing in the big slot above. With
                    the figures hidden the place has taken that slot, and
                    repeating it here would print it twice. */}
                {showNumbers && (
                  <span className="absolute bottom-1.5 text-[11px] font-bold opacity-60">
                    {place.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    day?: string;
    tz?: string;
  }>;
}) {
  const { range: raw, from, to, day: rawDay, tz: rawTz } = await searchParams;
  const range = RANGES.some((r) => r.key === raw) ? raw! : "today";
  // Any day the arrows or a shared link name. Validated the same way `from`
  // and `to` are, since it is concatenated into a `::date` downstream.
  const day = isStatsDate(rawDay) ? rawDay : undefined;

  // Both ends or neither. A half-typed range in a shared link would otherwise
  // resolve to something plausible that nobody chose, and these get pasted
  // into Discord — the board is a thing people send each other.
  const custom =
    isStatsDate(from) && isStatsDate(to)
      ? from <= to
        ? { from, to }
        : { from: to, to: from }
      : null;

  const me = await getCurrentUser();
  // Everyone else's figures are the founders' business, the same line
  // `/call-stats` already draws — it is admin-only for exactly this reason.
  // A caller still sees the ranking, and still sees their own numbers on the
  // card above: the board is a competition, not a window into a colleague's
  // week or their pay.
  const showNumbers = me?.role === "admin";
  // Which clock this board is read in: the URL first — the board gets pasted
  // into Discord, and a link should show what the sender was looking at — then
  // whatever this person last chose on either screen, then Eastern.
  const region = isStatsRegion(rawTz)
    ? rawTz
    : ((await statsRegionOf(me?.id)) ?? DEFAULT_STATS_REGION);
  const zone = statsZone(region);

  const today = todayInStatsTz(zone.tz);
  const [all, team] = await Promise.all([
    getPersonStats(
      custom
        ? { kind: "between", from: custom.from, to: custom.to, tz: zone.tz }
        : windowFor(range, day, zone.tz),
    ),
    listTeam(),
  ]);

  // Founders are not on the board. They are not doing this job, their history
  // predates staff logins and would sit unbeatable at the top of any range
  // wide enough to include it, and a leaderboard you cannot win is one nobody
  // looks at twice.
  const callers = new Set(
    team.filter((t) => t.role === "caller").map((t) => t.id),
  );
  const people = all
    .filter((p) => p.id !== null && callers.has(p.id))
    .sort((a, b) => b.demos - a.demos || b.calls - a.calls);

  const mine = people.find((p) => p.id === me?.id);
  const myRank = mine ? people.indexOf(mine) + 1 : null;
  const ahead = myRank && myRank > 1 ? people[myRank - 2] : null;
  // What it would take to move up one place, in the thing that is ranked.
  const gap = ahead && mine ? ahead.demos - mine.demos : 0;
  const topCalls = Math.max(1, ...people.map((p) => p.calls));

  return (
    <PageShell
      title="Scoreboard"
      actions={
        <>
          <RangeTabs
            ranges={RANGES}
            // A `?day=` that is neither today nor yesterday matches no tab, so
            // none is lit and the arrows carry the date instead. Passing the
            // resolved range would light a tab that is not what you are
            // looking at.
            active={day ? "" : range}
            custom={custom}
            today={today}
            // A custom range of one day is still a day, so it gets the arrows
            // too: picking a date in the dialog and then wanting the one
            // before it should not mean opening the dialog again.
            day={
              custom
                ? custom.from === custom.to
                  ? custom.from
                  : null
                : (day ?? dayOf(range, zone.tz))
            }
            zoneName={zone.name}
          />
          <TimezonePicker region={region} />
        </>
      }
    >
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
          {/* A number on its own does not tell you whether to push. The gap
              to the person above is the only figure that changes what you do
              next. */}
          {mine && ahead && (
            <p className="mt-2.5 border-t pt-2 text-[13px] text-muted-foreground">
              {gap > 0 ? (
                <>
                  <span className="font-bold text-foreground">
                    {gap} {gap === 1 ? "demo" : "demos"}
                  </span>{" "}
                  behind {ahead.name}.
                </>
              ) : (
                <>
                  Level with {ahead.name} on demos.{" "}
                  <span className="font-bold text-foreground">
                    {Math.max(0, ahead.calls - mine.calls) + 1} more calls
                  </span>{" "}
                  puts you ahead.
                </>
              )}
            </p>
          )}
          {mine && myRank === 1 && people.length > 1 && (
            <p className="mt-2.5 border-t pt-2 text-[13px] text-muted-foreground">
              Leading by{" "}
              <span className="font-bold text-foreground">
                {mine.demos - (people[1]?.demos ?? 0)}
              </span>
              . Second is {people[1]?.name}.
            </p>
          )}
          {(mine?.calls ?? 0) === 0 && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Nothing logged yet{" "}
              {!custom && range === "today" ? "today" : "in this range"}.
            </p>
          )}
        </div>

        {people.length > 0 && (
          <Podium people={people} meId={me?.id} showNumbers={showNumbers} />
        )}

        {people.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Trophy className="size-4 text-muted-foreground" strokeWidth={2.2} />
            <p className="text-sm font-extrabold tracking-[-0.01em]">Everyone</p>
            <p className="ml-auto text-[12px] text-muted-foreground">
              Ranked by demos, then calls
            </p>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left">
                    {(showNumbers
                      ? ["", "Person", "Calls", "Pickups", "Demos"]
                      : ["", "Person"]
                    ).map((h, i) => (
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
                        {showNumbers && (
                          <>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {/* Demos decide the ranking, but demos are rare and
                                  lumpy. The bar shows the dialling underneath
                                  them, which is the part a caller controls. */}
                              <span className="inline-flex items-center justify-end gap-2">
                                <span
                                  aria-hidden
                                  className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"
                                >
                                  <span
                                    className="block h-full rounded-full bg-primary/45"
                                    style={{
                                      width: `${Math.round((p.calls / topCalls) * 100)}%`,
                                    }}
                                  />
                                </span>
                                {p.calls.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                              {pct(p.pickups, p.calls)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                              {p.demos.toLocaleString()}
                            </td>
                          </>
                        )}
</tr>
                    );
                  })}
                </tbody>
              </table>
          </div>
        </div>
        )}
      </div>
    </PageShell>
  );
}
