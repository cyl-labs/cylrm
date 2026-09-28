"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WEEKLY_CALL_QUOTA } from "@/lib/call-quota";
import { STATS_TZ } from "@/lib/stats-zones";
import { cn } from "@/lib/utils";
import type { QuotaStanding } from "@/lib/quota-digest";

type Week = {
  since: string;
  until: string | null;
  standings: QuotaStanding[];
};

/** Weeks the picker offers, this one included. Matches `MAX_WEEKS_BACK` on
 *  the route plus this week. */
const WEEKS = 13;

const weekName = (back: number) =>
  back === 0 ? "This week" : back === 1 ? "Last week" : `${back} weeks ago`;

/** When a week reset, in Eastern, the clock the week is cut in. Naming it in
 *  the reader's zone would give an hour the reset does not happen at. */
const resetAt = new Intl.DateTimeFormat("en-US", {
  timeZone: STATS_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  timeZoneName: "short",
});

/**
 * The floor against the quota, a week at a time, on the Scoreboard.
 *
 * Moved here from Stats on 2026-09-28, with a week picker: Stats' range
 * dropdown never applied to it, so the only week anybody could see was the one
 * still running, and "did they hit it last week" had no answer anywhere.
 *
 * Fetched rather than rendered with the page. It was the reason Stats took six
 * seconds when it cost a query per caller; it is one grouped count now, so it
 * loads by itself instead of waiting behind a button, but it still should not
 * hold up the board above it.
 */
export function QuotaStandings() {
  const [back, setBack] = React.useState(0);
  // Keyed by the week it answers, so a slow answer for a week nobody is
  // looking at any more is never shown against the one they picked.
  const [data, setData] = React.useState<{ back: number; week: Week } | null>(
    null,
  );
  const [failed, setFailed] = React.useState<number | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    fetch(`/api/quota-standings?back=${back}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const week = (await res.json()) as Week;
        if (live) {
          setData({ back, week });
          setFailed(null);
        }
      })
      .catch(() => live && setFailed(back));
    return () => {
      live = false;
    };
  }, [back, nonce]);

  const week = data?.back === back ? data.week : null;
  const loading = week === null && failed !== back;

  return (
    <>
      <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold tracking-[-0.01em]">
            Calls against the {WEEKLY_CALL_QUOTA} quota
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {week ? (
              <>
                {week.until
                  ? `From ${resetAt.format(new Date(week.since))} to ${resetAt.format(new Date(week.until))}.`
                  : `Since the week reset on ${resetAt.format(new Date(week.since))}.`}{" "}
              </>
            ) : null}
            The pay week, worst first, and the same count the Friday
            notification sends. It does not follow the dates at the top.
            Anyone under a month on the team shows how long they had been here;
            no note means they had the whole week.
          </p>
        </div>
        <Select value={String(back)} onValueChange={(v) => setBack(Number(v))}>
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Which week">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: WEEKS }, (_, i) => (
              <SelectItem key={i} value={String(i)}>
                {weekName(i)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {failed === back ? (
        <div className="flex flex-col items-start gap-2 px-4 py-4">
          <p className="text-[13px] text-muted-foreground">
            Could not count that week. Check your connection and try again.
          </p>
          <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : loading || !week ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">Counting…</p>
      ) : week.standings.length === 0 ? (
        <p className="px-4 py-4 text-[13px]">
          <span className="font-semibold">Nobody to count for this week.</span>{" "}
          <span className="text-muted-foreground">
            {back === 0
              ? "A caller shows up here once they have a call list and a number to dial from. Set both on the Team screen."
              : "Nobody on the floor made a call that week. Pick a later week."}
          </span>
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {week.standings.map((s) => {
            const met = s.calls >= WEEKLY_CALL_QUOTA;
            // What to say about how new they are, and nothing at all once they
            // have been here a month: a tag on every row is noise, and its
            // absence has to mean something, which the note above says.
            const age = s.startedThisWeek
              ? `New · ${s.daysOfWeek} of 7 days`
              : s.daysOnTeam <= 30
                ? `${s.daysOnTeam} days on the team`
                : null;
            const width = Math.min(
              100,
              Math.round((s.calls / WEEKLY_CALL_QUOTA) * 100),
            );
            return (
              <li key={s.name} className="flex items-center gap-3 px-4 py-2">
                <span className="flex w-28 shrink-0 flex-col">
                  <span className="truncate text-[13px] font-semibold">
                    {s.name}
                  </span>
                  {age && (
                    <span className="truncate text-[10px] text-muted-foreground">
                      {age}
                    </span>
                  )}
                </span>
                {/* Decoration over the number printed beside it. */}
                <span
                  aria-hidden
                  className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      met ? "bg-success" : "bg-primary",
                    )}
                    style={{ width: `${width}%` }}
                  />
                </span>
                <span
                  className={cn(
                    "w-24 shrink-0 text-right text-[12px] tabular-nums",
                    met ? "font-semibold text-success" : "text-muted-foreground",
                  )}
                >
                  {s.calls.toLocaleString("en-US")} / {WEEKLY_CALL_QUOTA}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
