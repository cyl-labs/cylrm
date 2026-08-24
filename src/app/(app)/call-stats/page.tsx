import { getCallLists } from "@/lib/calls";
import Link from "next/link";
import {
  getCallTotals,
  getCallsByDay,
  getListStats,
  getOutcomeCounts,
  getCallLog,
  getPersonStats,
  todayInCallTz,
  CALL_LOG_LIMIT,
  type StatsWindow,
} from "@/lib/call-stats";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import type { CallOutcome } from "@/lib/calls";
import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";
import { CallFilters } from "@/components/calls/call-filters";
import { LogFilter } from "@/components/calls/log-filter";
import { listTeam } from "@/lib/users";

export const dynamic = "force-dynamic";

/** A Singapore date, N days back from today there. */
function dayBack(n: number) {
  const today = todayInCallTz();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** `?range=` for a rolling window or a named day, `?day=` for any other. Only
 *  one is ever in force. */
function windowFor(range: string, day: string | undefined): StatsWindow {
  if (day) return { kind: "day", date: day };
  if (range === "today") return { kind: "day", date: todayInCallTz() };
  if (range === "yesterday") return { kind: "day", date: dayBack(1) };
  if (range === "all") return { kind: "all" };
  return { kind: "rolling", days: Number(range) };
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

export default async function CallStatsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    list?: string;
    day?: string;
    person?: string;
    outcome?: string;
  }>;
}) {
  const {
    range: raw,
    list,
    day: rawDay,
    person,
    outcome: rawOutcome,
  } = await searchParams;

  // An outcome that is not one of ours falls back to all of them, like a
  // stale niche or person does.
  const outcome =
    rawOutcome && rawOutcome in OUTCOME_LABELS
      ? (rawOutcome as CallOutcome)
      : undefined;
  // Passed to the picker as-is. Not derived from the window: "today" is a
  // range that happens to resolve to a single day, and reading the window
  // back made the control show a date where it should say Today.
  const day = isDay(rawDay) ? rawDay : undefined;
  // Today by default. The question this screen gets asked most is "how is the
  // floor doing right now", and a month of history answered a different one.
  const range = raw && RANGE_KEYS.has(raw) ? raw : "today";
  const w = windowFor(range, day);

  const [allLists, team] = await Promise.all([getCallLists(), listTeam()]);

  // A `?person=` naming someone who has gone falls back to everyone, for the
  // same reason a stale `?list=` does: reporting zeroes would read as the
  // calling having stopped rather than as a filter pointing at nothing.
  const wantedPerson = Number(person);
  const personId = team.some((t) => t.id === wantedPerson)
    ? wantedPerson
    : undefined;
  // Deactivated people stay listed: their calls are still in the numbers and
  // last month's figures are a fair thing to go back and look at.
  const peopleOptions = team.map((t) => ({ id: t.id, name: t.name }));
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

  const [totals, outcomes, lists, byDay, people, log] = await Promise.all([
    getCallTotals(w, listId, personId),
    getOutcomeCounts(w, listId, personId),
    getListStats(w, listId, personId),
    getCallsByDay(14, listId, personId),
    getPersonStats(w, listId, personId),
    getCallLog(w, listId, personId, outcome),
  ]);

  // Each call is shown in its niche's own zone, with the zone named, because
  // "04:04" on a US lead is unreadable otherwise and quietly wrong if you take
  // it for local time. Eastern stands in for the US, which spans four zones:
  // it is the common case and an approximation stated is better than a number
  // that looks exact. Never the reader's zone, which would make the same call
  // read differently to two people looking at one screen.
  // Labelled here rather than by Intl, which names one zone and not the
  // other: en-US gives EDT for New York but GMT+1 for London, en-GB the
  // reverse. Two rows in one table should not be labelled two different ways.
  const ZONES = {
    sg: { tz: "Asia/Singapore", label: "SGT" },
    us: { tz: "America/New_York", label: "ET" },
    gb: { tz: "Europe/London", label: "UK" },
  } as const;
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const callTime = (iso: string, region: "sg" | "us" | "gb" | null) => {
    const { tz, label } = ZONES[region ?? "sg"];
    let f = formatters.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz,
      });
      formatters.set(tz, f);
    }
    return `${f.format(new Date(iso))} ${label}`;
  };

  const tiles = [
    { label: "Calls logged", value: totals.calls, sub: "attempts, not leads" },
    {
      label: "Leads dialled",
      value: totals.leadsDialled,
      sub: `${(totals.calls / (totals.leadsDialled || 1)).toFixed(1)} calls each`,
    },
    {
      label: "Pickups",
      value: totals.pickups,
      sub: `${pct(totals.pickups, totals.calls)} of calls`,
    },
    {
      label: "Demos booked",
      value: totals.demos,
      sub: `${per100(totals.demos, totals.calls)} per 100 calls`,
    },
    { label: "Trials started", value: totals.trials, sub: "reached a trial" },
    {
      label: "Won",
      value: totals.won,
      sub:
        totals.won + totals.lost === 0
          ? "contracts signed"
          : `${pct(totals.won, totals.won + totals.lost)} of decided`,
    },
  ];

  const busiest = Math.max(...byDay.map((d) => d.calls), 1);
  const outcomeTotal = outcomes.reduce((sum, o) => sum + o.calls, 0);

  return (
    <PageShell
      title="Call stats"
      actions={
        <CallFilters
          lists={nicheOptions.map((l) => ({ id: l.id, name: l.name }))}
          listId={listId ?? "all"}
          people={peopleOptions}
          personId={personId ?? "all"}
          range={range}
          day={day}
        />
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
        {w.kind === "day" && (
          <p className="text-[13px] text-muted-foreground">
            Showing <span className="font-bold">{dayLabel(w.date)}</span> only,
            Singapore time.{" "}
            <Link
              href={`/call-stats?${new URLSearchParams({
                ...(listId ? { list: String(listId) } : {}),
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
                What the calls did
              </p>
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
            <div className="border-b border-border/60 px-5 py-3.5">
              <p className="text-sm font-extrabold tracking-[-0.01em]">
                Last 14 days
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                Always the last fortnight, whatever the range above says. Tap a
                day to see just that day.
              </p>
            </div>
            <div className="flex items-end gap-1 px-5 py-4">
              {byDay.map((d) => {
                const picked = w.kind === "day" && w.date === d.day;
                return (
                  // A link, not a button: the chart is rendered on the server
                  // and picking a day is just another URL.
                  <Link
                    key={d.day}
                    href={`/call-stats?${new URLSearchParams({
                      ...(listId ? { list: String(listId) } : {}),
                      // Clicking the day already showing clears back to the
                      // fortnight, so the chart is its own way out.
                      ...(picked ? { range: "30" } : { day: d.day }),
                    })}`}
                    scroll={false}
                    title={`${d.day}: ${d.calls} calls, ${d.pickups} pickups`}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md py-1 transition-colors hover:bg-muted",
                      picked && "bg-primary/10 hover:bg-primary/10",
                    )}
                  >
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {d.calls || ""}
                    </span>
                    {/* No track behind the bar: a full-height grey box on a
                        day with no calls reads as a day with some. */}
                    <div
                      className="flex w-full flex-col justify-end border-b"
                      style={{ height: 64 }}
                    >
                      <div
                        className="flex w-full flex-col justify-end rounded-sm bg-primary/25"
                        style={{ height: `${(d.calls / busiest) * 100}%` }}
                      >
                        <div
                          className="w-full rounded-sm bg-primary"
                          style={{
                            height: `${d.calls === 0 ? 0 : (d.pickups / d.calls) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums text-muted-foreground/70",
                        picked && "font-bold text-primary",
                      )}
                    >
                      {d.day.slice(8)}
                    </span>
                  </Link>
                );
              })}
            </div>
            <p className="px-5 pb-4 text-[11px] text-muted-foreground/75">
              Solid is pickups, pale is the rest of the calls.
            </p>
          </div>
        </div>

        {/* By person. Hidden when there is only the one unattributed row —
            before anyone has signed in and called, a table of one line
            labelled "Not attributed" is noise. */}
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
              By list
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              Leads and worked are lifetime; calls onwards are the selected
              range.
            </p>
          </div>
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
        </div>

        {/* The tables above answer "how many". This one answers "which ones",
            which is what you open when a number looks wrong. */}
        <div className={cn(CARD, "overflow-hidden")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-3">
            <p className="text-sm font-extrabold tracking-[-0.01em]">
              Every call
            </p>
            <p className="text-[12px] text-muted-foreground">
              {log.length === CALL_LOG_LIMIT
                ? `Newest ${CALL_LOG_LIMIT}, oldest cut off`
                : "Newest first"}
            </p>
            <div className="ml-auto w-full sm:w-auto">
              <LogFilter
                outcome={outcome ?? "all"}
                listId={listId ?? "all"}
                personId={personId ?? "all"}
                range={range}
                day={day}
              />
            </div>
          </div>
          {log.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              {outcome
                ? `Nothing logged as ${OUTCOME_LABELS[outcome].toLowerCase()} in this range.`
                : "No calls logged in this range."}
            </p>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left">
                    {["When", "Who", "Business", "Niche", "Logged as"].map(
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
                  {log.map((c) => (
                    <tr key={c.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                        {callTime(c.calledAt, c.region)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold">
                        {c.by}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold">{c.company}</span>
                        <span className="block text-[12px] tabular-nums text-muted-foreground">
                          {c.phone}
                        </span>
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
                        {c.listName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span className="font-semibold">
                          {OUTCOME_LABELS[c.outcome]}
                        </span>
                        {c.outcome === "callback" && c.callbackAt && (
                          <span className="block text-[12px] text-muted-foreground">
                            for {callTime(c.callbackAt, c.region)}
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
