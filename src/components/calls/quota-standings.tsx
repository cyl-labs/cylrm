"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WEEKLY_CALL_QUOTA } from "@/lib/call-quota";
import { cn } from "@/lib/utils";
import type { QuotaStanding } from "@/lib/quota-digest";

/**
 * The floor against the quota, fetched when somebody asks for it.
 *
 * It was rendered with the rest of Stats, and it was the reason that page took
 * six seconds: a full set of call totals per caller, worked out for everybody
 * who opened the screen. Most visits to Stats are about a day or a niche, and
 * this card answers a question about the week — so it waits to be asked.
 *
 * The button says what it is going to do and why it is not already done, since
 * a card that is blank until pressed otherwise reads as one that is broken.
 * `WEEKLY_CALL_QUOTA` is imported straight from `lib/call-quota`, which has no
 * database import for exactly this reason.
 */
export function QuotaStandings() {
  const [standings, setStandings] = React.useState<QuotaStanding[] | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);

  async function load() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/quota-standings");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not work out the standings.");
        return;
      }
      const data = (await res.json()) as { standings: QuotaStanding[] };
      setStandings(data.standings ?? []);
    } catch {
      toast.error("Could not reach the CRM, so nothing was counted.");
    } finally {
      setLoading(false);
    }
  }

  if (standings === null) {
    return (
      <div className="flex flex-col items-start gap-2 px-5 py-4">
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? "Counting…" : "Show this week's standings"}
        </Button>
        <p className="text-[12px] text-muted-foreground">
          Counting everybody&rsquo;s week takes a few seconds, so it is not done
          until you ask. Nothing else on this screen waits for it.
        </p>
      </div>
    );
  }

  if (standings.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 px-5 py-4">
        <p className="text-[13px]">
          <span className="font-semibold">Nobody to count yet.</span>{" "}
          <span className="text-muted-foreground">
            A caller shows up here once they have a niche assigned and a number
            to dial from. Set both on the Team screen.
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? "Counting…" : "Check again"}
        </Button>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border/60">
        {standings.map((s) => {
          const met = s.calls >= WEEKLY_CALL_QUOTA;
          // What to say about how new they are, and nothing at all once they
          // have been here a month: a tag on every row is noise, and its
          // absence has to mean something, which the note above the list says
          // out loud.
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
            <li key={s.name} className="flex items-center gap-3 px-5 py-2">
              <span className="flex w-28 shrink-0 flex-col">
                <span className="truncate text-[13px] font-semibold">
                  {s.name}
                </span>
                {/* Under the name rather than beside it: the row is already
                    name, bar and count, and a fourth column would take the
                    bar's width on a phone. Shown only while it could be the
                    explanation — see the note in `QuotaStanding`. */}
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
                {s.calls.toLocaleString()} / {WEEKLY_CALL_QUOTA}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="px-5 pb-3 pt-2">
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? "Counting…" : "Refresh"}
        </Button>
      </div>
    </>
  );
}
