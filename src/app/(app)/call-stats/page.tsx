import { getCallLists, LEAD_HOURS_LABEL } from "@/lib/calls";
import Link from "next/link";
import {
  dayBackInStatsTz,
  getCallTotals,
  getCallsByMonth,
  getListStats,
  getOutcomeCounts,
  getCallLog,
  getPersonStats,
  todayInStatsTz,
  monthInStatsTz,
  monthOf,
  isStatsMonth,
  isNonOutcomeLogFilter,
  statsZone,
  CALL_LOG_LIMIT,
  type StatsWindow,
  type LogFilterValue,
  type PersonStat,
} from "@/lib/call-stats";
import { DEFAULT_STATS_REGION, isStatsRegion } from "@/lib/stats-zones";
import { CallCalendar } from "@/components/calls/call-calendar";
import { TimezonePicker } from "@/components/calls/timezone-picker";
import { getCurrentUser } from "@/lib/session";
import { statsRegionOf } from "@/lib/users";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";
import { CallFilters } from "@/components/calls/call-filters";
import { LogFilter } from "@/components/calls/log-filter";
import { LogRecording } from "@/components/calls/log-recording";
import { listTeam, type TeamMember } from "@/lib/users";

export const dynamic = "force-dynamic";

/** A date in the reporting zone, N days back from today there. Shared with the
 *  Scoreboard rather than written twice: two versions of "what date was N days
 *  ago" is two answers to the same question on two screens. */
const dayBack = dayBackInStatsTz;

/** `?range=` for a rolling window or a named day, `?day=` for any other. Only
 *  one is ever in force. The zone rides along on the window, so every query
 *  below cuts its days the same way this screen labels them. */
function windowFor(
  range: string,
  day: string | undefined,
  tz: string,
): StatsWindow {
  if (day) return { kind: "day", date: day, tz };
  if (range === "today") return { kind: "day", date: todayInStatsTz(tz), tz };
  if (range === "yesterday") return { kind: "day", date: dayBack(1, tz), tz };
  if (range === "all") return { kind: "all", tz };
  return { kind: "rolling", days: Number(range), tz };
}

// "yesterday" and "90" are gone from the picker but still honoured: a
// bookmarked URL should not silently become something else.
const RANGE_KEYS = new Set(["today", "yesterday", "7", "30", "90", "all"]);
const isDay = (v: string | undefined): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const pct = (num: number, den: number) =>
  den === 0 ? "-" : `${((num / den) * 100).toFixed(1)}%`;
const per100 = (num: number, den: number) =>
  den === 0 ? "-" : ((num / den) * 100).toFixed(1);

const CARD = "rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]";

/**
 * Two screens sharing one page, told apart by `mine`.
 *
 * An admin gets the floor: everyone's calls, every niche, a person picker and
 * a By-person table. A caller gets exactly their own — their calls, their
 * niches, and the recording of every dial they made — and nothing that would
 * let them widen it. It was closed to callers entirely until 2026-09-06, which
 * cost the wrong thing: with the Scoreboard shut as well, the people doing the
 * dialling had no way to see their own day, hear a call back, or check a
 * figure they are paid on. None of that is anybody else's business to protect.
 *
 * `mine` is the whole control and it is deliberately one flag, not a filter
 * defaulted differently: `?person=` is not read at all for a caller, so the
 * scope cannot be undone by a query string. Every query below takes `personId`
 * — which is *them* — and the two that would otherwise reach past it are
 * `getCallLists`/`getListStats`, which take `scopeId` for the niches they may
 * see. **Anything added to this screen has to take one or the other**, or it
 * will quietly show a caller the floor.
 *
 * Not a second screen at `/my-stats`, for the reason the quota bar counts
 * through `getCallTotals`: two ways of counting a day puts two numbers in
 * front of one caller, and the one they read had better be the one their pay
 * is worked out from.
 */
export default async function CallStatsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    list?: string;
    day?: string;
    person?: string;
    outcome?: string;
    month?: string;
    tz?: string;
  }>;
}) {
  const {
    range: raw,
    list,
    day: rawDay,
    person,
    outcome: rawOutcome,
    month: rawMonth,
    tz: rawTz,
  } = await searchParams;

  // Which clock this screen is read in: the URL first, then whatever this
  // person last chose, then Eastern. The URL wins because it is somebody
  // saying which zone they mean for *this* look — including a link they were
  // sent, which should show what the sender was looking at.
  const me = await getCurrentUser();
  // A session with no user resolves to a caller with an id nothing matches,
  // exactly as `callScope` does: a bug upstream fails closed to an empty
  // screen rather than open to the whole floor's numbers.
  const mine = me?.role !== "admin";
  const scopeId = mine ? (me?.id ?? -1) : undefined;
  const region = isStatsRegion(rawTz)
    ? rawTz
    : ((await statsRegionOf(me?.id)) ?? DEFAULT_STATS_REGION);
  const zone = statsZone(region);

  // An outcome that is not one of ours falls back to all of them, like a
  // stale niche or person does. "keypad" is not an outcome — it asks for the
  // rows that have none — and is honoured for the same reason.
  const outcome: LogFilterValue | undefined = isNonOutcomeLogFilter(rawOutcome)
    ? rawOutcome
    : rawOutcome && rawOutcome in OUTCOME_LABELS
      ? (rawOutcome as LogFilterValue)
      : undefined;
  // Passed to the picker as-is. Not derived from the window: "today" is a
  // range that happens to resolve to a single day, and reading the window
  // back made the control show a date where it should say Today.
  const day = isDay(rawDay) ? rawDay : undefined;
  // Today by default. The question this screen gets asked most is "how is the
  // floor doing right now", and a month of history answered a different one.
  const range = raw && RANGE_KEYS.has(raw) ? raw : "today";
  const w = windowFor(range, day, zone.tz);

  // The calendar's own month. It follows the window unless the arrows have
  // been used, and the filter controls deliberately do NOT carry `?month=`
  // through — the inverse of the `?list=` trap they exist for. Changing the
  // range should move the calendar to the range's month; only paging months
  // pins one.
  const month = isStatsMonth(rawMonth) ? rawMonth : monthOf(w);
  // The days the numbers above cover, for the calendar to outline. A rolling
  // window is a clock rather than a set of dates, so it is drawn as the N
  // calendar days ending today, which is what "last 7 days" means to a reader.
  const covered: { from?: string; to?: string } =
    w.kind === "day"
      ? { from: w.date, to: w.date }
      : w.kind === "between"
        ? { from: w.from, to: w.to }
        : w.kind === "rolling"
          ? { from: dayBack(w.days - 1, zone.tz), to: todayInStatsTz(zone.tz) }
          : {};

  const [allLists, team] = await Promise.all([
    getCallLists(scopeId),
    // Not asked for at all on a caller's own screen: it is the roster, and the
    // only thing this page wants it for is a picker they do not get.
    mine ? Promise.resolve<TeamMember[]>([]) : listTeam(),
  ]);

  // A `?person=` naming someone who has gone falls back to everyone, for the
  // same reason a stale `?list=` does: reporting zeroes would read as the
  // calling having stopped rather than as a filter pointing at nothing.
  //
  // For a caller it is not read at all. Their scope is who they are rather
  // than a parameter, and the one thing a scoped screen must not have is a
  // query string that widens it.
  const wantedPerson = Number(person);
  const personId = mine
    ? scopeId
    : team.some((t) => t.id === wantedPerson)
      ? wantedPerson
      : undefined;
  // Deactivated people stay listed: their calls are still in the numbers and
  // last month's figures are a fair thing to go back and look at.
  const peopleOptions = team.map((t) => ({ id: t.id, name: t.name }));
  // Their own id never goes into a link. It would be ignored on the way back
  // in, and a URL carrying a person id suggests it could carry somebody
  // else's.
  const personParam: Record<string, string> =
    !mine && personId ? { person: String(personId) } : {};
  // A `?list=` naming a niche that has gone falls back to all of them rather
  // than reporting zeroes as if the calling had stopped.
  const wanted = Number(list);
  const listId = allLists.some((l) => l.id === wanted) ? wanted : undefined;

  // A niche nobody has rung has nothing to report, and fourteen of them made
  // the picker a wall. The one in force stays listed even if it is empty, so
  // the control never shows a blank.
  const nicheOptions = allLists.filter(
    (l) => l.total - l.uncalled > 0 || l.id === listId,
  );

  const [totals, outcomes, lists, monthDays, people, log] = await Promise.all([
    getCallTotals(w, listId, personId),
    getOutcomeCounts(w, listId, personId),
    // `scopeId` as well as `personId`: one narrows the numbers to their calls,
    // the other narrows the rows to their niches. Without the second a caller
    // would be handed every niche on the floor, most of them reading zero.
    getListStats(w, listId, personId, scopeId),
    getCallsByMonth(month, listId, personId, zone.tz),
    // A breakdown by person, on a screen showing one person, is a table of one
    // row saying what the tiles above it already say.
    mine ? Promise.resolve<PersonStat[]>([]) : getPersonStats(w, listId, personId),
    getCallLog(w, listId, personId, outcome),
  ]);

  // Every row in the screen's own zone, and never the reader's browser zone,
  // which would render one string on the server and another on hydration.
  //
  // Until 2026-08-29 each row was shown in its niche's market instead, on the
  // reasoning that "04:04" on a US lead is unreadable if you take it for local
  // time. The timezone picker answers that better: one zone, chosen and named
  // at the top of the screen, so the whole page agrees with itself and a link
  // carries the zone it was read in. The column heading says which.
  const timeFormat = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone.tz,
  });
  const callTime = (iso: string) => timeFormat.format(new Date(iso));

  // The labels are the same six words on both versions of this screen, and
  // deliberately so: a caller is paid per fifty *pickups*, the word is on the
  // Scoreboard and in Payroll, and renaming it here to something friendlier
  // would cut their own screen off from the one figure they are paid on. What
  // changes is the line under it — an admin reads these as ratios, and a
  // caller needs to be told in words what the number counted.
  const tiles = [
    {
      label: "Calls logged",
      value: totals.calls,
      sub: mine ? "every dial you made" : "attempts, not leads",
    },
    {
      label: "Leads dialled",
      value: totals.leadsDialled,
      sub: mine
        ? `businesses you rang, ${(totals.calls / (totals.leadsDialled || 1)).toFixed(1)} calls each`
        : `${(totals.calls / (totals.leadsDialled || 1)).toFixed(1)} calls each`,
    },
    {
      label: "Pickups",
      value: totals.pickups,
      sub: mine
        ? `someone answered, ${pct(totals.pickups, totals.calls)} of your calls`
        : `${pct(totals.pickups, totals.calls)} of calls`,
    },
    {
      label: "Demos booked",
      value: totals.demos,
      sub: mine
        ? "meetings you set up"
        : `${per100(totals.demos, totals.calls)} per 100 calls`,
    },
    {
      label: "Trials started",
      value: totals.trials,
      sub: mine ? "went on to a free trial" : "reached a trial",
    },
    {
      label: "Won",
      value: totals.won,
      sub:
        mine || totals.won + totals.lost === 0
          ? "contracts signed"
          : `${pct(totals.won, totals.won + totals.lost)} of decided`,
    },
  ];

  const outcomeTotal = outcomes.reduce((sum, o) => sum + o.calls, 0);

  return (
    <PageShell
      // Said in the title rather than left to be worked out from the numbers:
      // a caller opening a screen called Call stats would reasonably read it
      // as the floor's and their own figures as everybody's.
      title={mine ? "My stats" : "Call stats"}
      actions={
        <>
          <CallFilters
            lists={nicheOptions.map((l) => ({ id: l.id, name: l.name }))}
            listId={listId ?? "all"}
            // Undefined drops the picker entirely, and "all" keeps their own
            // id out of every query string the filters rebuild.
            people={mine ? undefined : peopleOptions}
            personId={mine ? "all" : (personId ?? "all")}
            range={range}
            day={day}
            tz={region}
          />
          {/* Last of the four: it is the one you set once and leave, where
              the niche, the person and the range are what a reader moves
              through while looking at something. */}
          <TimezonePicker region={region} />
        </>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
        {/* Said once, at the top, in three short sentences.
            "Demos booked: 3" on a screen that might be the floor's is a
            different number from the same tile on a screen that is definitely
            yours; the calendar is the control people miss, because a grid of
            dates does not look like a filter; and the last sentence is the
            only thing that tells anyone the recordings are down there at all. */}
        {mine && (
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-[13px] leading-relaxed">
            <p>
              These are{" "}
              <span className="font-semibold">your own calls</span> and nobody
              else&rsquo;s. It starts on today &mdash; tap any date on the
              calendar below to see that day instead.
            </p>
            <p className="mt-1 text-muted-foreground">
              Scroll down to <span className="font-semibold">Your calls</span>{" "}
              for the list of every one you made, where the calls you dialled
              from the browser have a{" "}
              <span className="font-semibold">Listen back</span> button.
            </p>
          </div>
        )}

        {/* A caller opening this at nine in the morning sees six zeroes, which
            reads as a broken screen rather than as a day that has not started.
            Said plainly, with the two ways out: another day, or the dialler. */}
        {mine && totals.calls === 0 && (
          <p className="text-[13px]">
            <span className="font-semibold">No calls here yet.</span>{" "}
            <span className="text-muted-foreground">
              {w.kind === "day"
                ? "Nothing was logged on this day."
                : "Nothing was logged in this range."}{" "}
              Pick a different date on the calendar below, or open{" "}
            </span>
            <Link
              href="/calls"
              className="font-semibold text-primary hover:underline"
            >
              Call lists
            </Link>
            <span className="text-muted-foreground"> to start dialling.</span>
          </p>
        )}
        {w.kind === "day" && (
          <p className="text-[13px] text-muted-foreground">
            Showing <span className="font-bold">{dayLabel(w.date)}</span> only,{" "}
            {zone.name} time.{" "}
            <Link
              href={`/call-stats?${new URLSearchParams({
                ...(listId ? { list: String(listId) } : {}),
                ...(region !== DEFAULT_STATS_REGION ? { tz: region } : {}),
                range: "30",
              })}`}
              className="font-semibold text-primary hover:underline"
            >
              Back to the last 30 days
            </Link>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => (
            <div key={t.label} className={`${CARD} px-4 py-3`}>
              <p className="text-xs font-semibold text-muted-foreground">
                {t.label}
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
                {t.value.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                {t.sub}
              </p>
            </div>
          ))}
        </div>

        {/* These three are milestones reached, not places leads are sitting.
            Without saying so the tiles look like they disagree with the
            spreadsheet, whose categories come from each lead's latest call. */}
        <p className="text-[13px] text-muted-foreground">
          Demos, trials and won count every lead that reached that stage in the
          range, even if it has since moved on. The spreadsheet shows where a
          lead sits <span className="font-semibold">now</span>, so filtering it
          by category can give a smaller number.
        </p>

        {/* Said up here, not left to be found by scrolling three hundred rows.
            The denominator is calls whose zone is known, never every call:
            toll-free numbers and unmapped area codes belong to no place, and
            counting them in either half would be a guess presented as a
            figure. */}
        {totals.outsideHours > 0 && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
            <span className="font-bold text-destructive">
              {totals.outsideHours.toLocaleString()}{" "}
              {totals.outsideHours === 1 ? "call was" : "calls were"} placed
              outside {LEAD_HOURS_LABEL} where the prospect is
            </span>
            <span className="text-muted-foreground">
              {" "}
              ({pct(totals.outsideHours, totals.zoneKnown)} of the{" "}
              {totals.zoneKnown.toLocaleString()} whose timezone we know).{" "}
              {/* Straight to the rows rather than "they are marked below":
                  finding 35 red cells in three hundred rows is the work this
                  sentence was creating. The filter is on the table, so the
                  tiles above stay the whole range. */}
              <Link
                href={`/call-stats?${new URLSearchParams({
                  ...(listId ? { list: String(listId) } : {}),
                  ...personParam,
                  ...(day ? { day } : { range }),
                  ...(region !== DEFAULT_STATS_REGION ? { tz: region } : {}),
                  outcome: "outside_hours",
                })}`}
                className="font-semibold text-destructive underline underline-offset-2"
              >
                Show just those calls
              </Link>{" "}
              {/* Named as the card is actually headed on this version of the
                  screen: a link pointing at "Every call" on a page whose table
                  says "Your calls" is a link to something that is not there. */}
              in {mine ? "Your calls" : "Every call"} below. The dialler hides
              these leads by default, so a call here was placed either with{" "}
              <span className="font-semibold">Open now</span> switched off or
              from a callback booked for that time.
            </span>
          </p>
        )}

        {totals.badNumbers > 0 && (
          <p className="text-[13px] text-muted-foreground">
            {totals.badNumbers.toLocaleString()}{" "}
            {totals.badNumbers === 1 ? "number was" : "numbers were"} logged as
            bad. Those are wrong in the source data, and can be corrected on
            the spreadsheet rather than re-dialled.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className={CARD}>
            <div className="border-b border-border/60 px-5 py-3.5">
              <p className="text-sm font-extrabold tracking-[-0.01em]">
                {mine ? "How your calls ended" : "What the calls did"}
              </p>
              {/* An admin knows these bars are the outcome each call was
                  logged as. A caller needs telling that this is the same menu
                  they tap on the dial card, or the card reads as a second set
                  of numbers rather than the same ones counted up. */}
              {mine && (
                <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                  What you tapped at the end of each call.
                </p>
              )}
            </div>
            <div className="space-y-2.5 px-5 py-4">
              {outcomes.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No calls logged in this range.
                </p>
              ) : (
                outcomes.map((o) => (
                  <div key={o.outcome}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-semibold">
                        {OUTCOME_LABELS[o.outcome]}
                      </span>
                      <span className="text-[13px] font-bold tabular-nums text-muted-foreground">
                        {o.calls.toLocaleString()} ·{" "}
                        {pct(o.calls, outcomeTotal)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${(o.calls / (outcomeTotal || 1)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={CARD}>
            <CallCalendar
              month={month}
              days={monthDays}
              // Everything the rest of the screen is filtered by, so paging a
              // month or tapping a day keeps the niche, the person and the
              // outcome that made the numbers worth reading. `month` is
              // deliberately absent: the calendar sets it, and a day tapped
              // inside it lands in that month anyway.
              params={{
                ...(listId ? { list: String(listId) } : {}),
                ...personParam,
                ...(outcome ? { outcome } : {}),
                ...(region !== DEFAULT_STATS_REGION ? { tz: region } : {}),
                ...(day ? { day } : { range }),
              }}
              selectedDay={w.kind === "day" ? w.date : undefined}
              from={covered.from}
              to={covered.to}
              today={todayInStatsTz(zone.tz)}
              maxMonth={monthInStatsTz(zone.tz)}
            />
          </div>
        </div>

        {/* By person. Empty on a caller's own screen, and hidden when there is
            only the one unattributed row — before anyone has signed in and
            called, a table of one line labelled "Not attributed" is noise. */}
        {(people.length > 1 || people.some((p) => p.id !== null)) && (
          <div className={CARD}>
            <div className="border-b border-border/60 px-5 py-3.5">
              <p className="text-sm font-extrabold tracking-[-0.01em]">
                By person
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                Who logged the call, in the selected range.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    {["Person", "Calls", "Pickups", "Demos", "Trials", "Won"].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={cn(
                            "whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                            i > 0 && "text-right",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr
                      key={p.id ?? "unattributed"}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td
                        className={cn(
                          "max-w-[16rem] truncate px-4 py-2 font-semibold",
                          // The pre-accounts calls are real but nobody's, and
                          // styling them like a colleague invites the question
                          // of who "Not attributed" is.
                          p.id === null && "font-medium text-muted-foreground",
                        )}
                      >
                        {p.name}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.calls.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {p.pickups.toLocaleString()} ({pct(p.pickups, p.calls)})
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.demos.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.trials.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums">
                        {p.won.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className={CARD}>
          <div className="border-b border-border/60 px-5 py-3.5">
            <p className="text-sm font-extrabold tracking-[-0.01em]">
              {mine ? "Your niches" : "By list"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              {mine
                ? "Leads is the size of the niche and worked is how many of them you have ever rung. Calls onwards are only the dates above."
                : "Leads and worked are lifetime; calls onwards are the selected range."}
            </p>
          </div>
          {/* A table of headings over nothing is the state a new caller lands
              in, and an unassigned niche is invisible to them — so the screen
              has to say that rather than look broken. See
              `call_list.assigned_user_id`: nobody is refused a call they can
              reach, but they cannot reach what is not theirs. */}
          {lists.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              {mine
                ? "No niches are assigned to you yet. Ask whoever runs the floor to put you on one, and your numbers will start showing up here."
                : "No call lists yet. Import a CSV on the Call lists screen."}
            </p>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  {[
                    "List",
                    "Leads",
                    "Worked",
                    "Calls",
                    "Pickups",
                    "Demos",
                    "Trials",
                    "Won",
                  ].map((h, i) => (
                    <th
                      key={h}
                      className={`whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground ${
                        i === 0 ? "" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[16rem] truncate px-4 py-2 font-semibold">
                      {l.name}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {l.leads.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {l.worked.toLocaleString()} ({pct(l.worked, l.leads)})
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {l.calls.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {l.pickups.toLocaleString()} ({pct(l.pickups, l.calls)})
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {l.demos.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {l.trials.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">
                      {l.won.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {/* The tables above answer "how many". This one answers "which ones",
            which is what you open when a number looks wrong — and, for a
            caller, it is the only place a recording can be played from. */}
        <div className={cn(CARD, "overflow-hidden")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-3">
            <p className="text-sm font-extrabold tracking-[-0.01em]">
              {mine ? "Your calls" : "Every call"}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {log.length === CALL_LOG_LIMIT
                ? `Newest ${CALL_LOG_LIMIT}, oldest cut off`
                : "Newest first"}
              {/* Said once here rather than on every keypad row. The rows are
                  marked, and what a reader needs is why a call in this table
                  is in none of the numbers above it. */}
              {!listId && " · keypad dials included, counted nowhere else"}
            </p>
            <div className="ml-auto w-full sm:w-auto">
              <LogFilter
                outcome={outcome ?? "all"}
                listId={listId ?? "all"}
                personId={mine ? "all" : (personId ?? "all")}
                range={range}
                day={day}
                tz={region}
              />
            </div>
          </div>
          {log.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              {outcome === "keypad"
                ? listId
                  ? "Keypad calls belong to no niche, so none show while one is selected."
                  : "Nothing dialled from the keypad in this range."
                : outcome === "outside_hours"
                  ? "Every call in this range was placed inside 9am to 5pm where the prospect is."
                  : outcome
                    ? `Nothing logged as ${OUTCOME_LABELS[outcome].toLowerCase()} in this range.`
                    : "No calls logged in this range."}
            </p>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left">
                    {/* The zone is on the heading rather than repeated on
                        every row: one screen, one clock, said once. */}
                    {[
                      `When (${zone.label})`,
                      "Their time",
                      // Every row on a caller's own screen says their name, so
                      // the column is one value repeated three hundred times.
                      ...(mine ? [] : ["Who"]),
                      "Business",
                      "Niche",
                      "Logged as",
                    ].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.map((c) => (
                    // Ids are unique within a table and this list spans two.
                    <tr
                      key={`${c.source}-${c.id}`}
                      className="border-b align-top last:border-0"
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                        {callTime(c.calledAt)}
                        {/* Under the time rather than in a column of its own:
                            most calls have no audio — every handset call and
                            every no-answer — and a column that is empty on
                            most rows is a column of nothing, the same reason
                            notes hang under the business. */}
                        {c.recordingId && (
                          <LogRecording
                            recordingId={c.recordingId}
                            recordingMs={c.recordingMs}
                            company={c.company}
                            callerName={c.by}
                            mine={mine}
                          />
                        )}
                      </td>
                      {/* The clock the person who answered was reading, which
                          is the only one that says whether this call should
                          have been placed. A column rather than a line under
                          the time above it: every prospect row has one, and it
                          is scanned down the page looking for the odd hour. */}
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                        {c.theirTime === null ? (
                          <span
                            className="text-muted-foreground"
                            title={
                              c.source === "keypad"
                                ? "A keypad dial has no lead, so no zone to read."
                                : "No zone for this number: toll-free, or an area code we have no row for."
                            }
                          >
                            &mdash;
                          </span>
                        ) : c.inHours === false ? (
                          // The flag. Stated in words as well as colour, since
                          // "03:12" is only obviously wrong once you know it
                          // is the prospect's clock and not the screen's.
                          <span className="font-bold text-destructive">
                            {c.theirTime}
                            <span className="block text-[11px] font-semibold">
                              outside 9&ndash;5
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {c.theirTime}
                          </span>
                        )}
                      </td>
                      {!mine && (
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold">
                          {c.by}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <span className="font-semibold">{c.company}</span>
                        {/* A keypad row whose business column is already the
                            number would otherwise print it twice. */}
                        {c.company !== c.phone && (
                          <span className="block text-[12px] tabular-nums text-muted-foreground">
                            {c.phone}
                          </span>
                        )}
                        {c.addedToCall && (
                          <span className="block text-[12px] text-muted-foreground">
                            Added to a call
                          </span>
                        )}
                        {/* Notes hang under the business rather than getting a
                            column of their own: most calls have none, and an
                            empty column on every row is a column of nothing. */}
                        {c.notes && (
                          <span className="mt-1 block max-w-md whitespace-pre-wrap text-[12px] text-muted-foreground">
                            {c.notes}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {c.listName ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {/* A keypad call has no outcome to log — there is no
                            lead for one to be about — so the cell says which
                            kind of call it was instead, in the muted weight
                            the "—" above uses for the same absence. */}
                        <span
                          className={cn(
                            "font-semibold",
                            !c.outcome && "font-medium text-muted-foreground",
                          )}
                        >
                          {c.outcome ? OUTCOME_LABELS[c.outcome] : "Keypad"}
                        </span>
                        {c.outcome === "callback" && c.callbackAt && (
                          <span className="block text-[12px] text-muted-foreground">
                            for {callTime(c.callbackAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
