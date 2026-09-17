"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDemoInputs } from "@/components/sop/demo-numbers";
import {
  MINUTES_PER_CALL,
  WEEKS_PER_MONTH,
  spokenMoney,
  workOut,
} from "@/lib/demo-calc";
import {
  PACKAGES,
  TERMS,
  commitmentCents,
  money,
  monthlyCents,
} from "@/lib/packages";
import { cn } from "@/lib/utils";

/**
 * The demo's arithmetic, done while the prospect is still talking.
 *
 * The closing procedure asks a founder to work out two things out loud: what
 * the prospect is losing to missed calls, and which package their volume puts
 * them on. Both are simple sums and both are easy to fumble mid-sentence — the
 * one that matters most, the package, was being picked by feel until it was
 * written down as minutes.
 *
 * It reads its prices from `lib/packages.ts`, the same module the contracts are
 * drafted from, so a quote here and the agreement that follows cannot disagree.
 * The sums themselves are in `lib/demo-calc.ts`, shared with the script lines
 * further down the document that say these figures back. The two boxes live in
 * `DemoNumbersProvider` for the same reason.
 */
export function PricingCalculator() {
  const { callsPerWeek, ticket, setCallsPerWeek, setTicket } = useDemoInputs();
  const n = workOut(callsPerWeek, ticket);
  const { calls, job, hasCalls, hasTicket, callsMonthly, minutes, lossCents } = n;
  const { priced, noOverage } = n;
  const cheapest = n.cheapest?.pkg.id ?? null;

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        Work out their numbers
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="calc-calls">Missed calls a week</Label>
          <Input
            id="calc-calls"
            inputMode="decimal"
            value={callsPerWeek}
            onChange={(e) => setCallsPerWeek(e.target.value)}
            placeholder="4"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="calc-ticket">Average job value ($)</Label>
          <Input
            id="calc-ticket"
            inputMode="decimal"
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
            placeholder="500"
          />
        </div>
      </div>

      {!hasCalls ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Their two numbers, from the questions above. Everything below is worked
          out at two minutes a call.
        </p>
      ) : (
        <>
          {/* The line to say, with their own figures in it rather than an
              example to swap numbers into mid-sentence. The script used to
              carry "say it's four missed calls a week, average job is $500",
              and a founder reading that aloud has to do two substitutions and
              two sums while a prospect waits — which is the whole job this
              component exists to take off them.

              Styled by hand to match SopProse's "You say" block, because the
              calculator renders outside SopProse and none of its `[&_...]`
              descendant rules reach in here: flat tint, no card or border, the
              label small and red. If that block's look changes, this changes
              with it, or the one line a founder is meant to read aloud stops
              looking like the others. The label is inline rather than in the
              76px gutter the prose uses at sm — the card's own padding would
              leave a gutter here sitting a few pixels off every block above it,
              which reads worse than not matching at all.

              Only with both numbers: the loss is calls times ticket, so with
              one box filled there is no sentence to say yet. */}
          {hasTicket && (
            <p className="mt-3.5 rounded-[3px] bg-[#FDE7E1] px-3.5 py-2.5 text-[15px] leading-relaxed text-foreground dark:bg-[#46352d]">
              <strong className="mr-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#C0392B] dark:text-[#e8897a]">
                You say
              </strong>
              {"So let's make it easy. You're missing about "}
              <span className="font-bold tabular-nums">{calls}</span>
              {" calls a week and an average job is "}
              <span className="font-bold tabular-nums">
                ${spokenMoney(job * 100)}
              </span>
              {" — that's "}
              <span className="font-bold tabular-nums">
                ${spokenMoney(calls * job * 100)}
              </span>
              {" a week, about "}
              <span className="font-bold tabular-nums">
                ${spokenMoney(lossCents)}
              </span>
              {" a month potentially slipping through the cracks."}
            </p>
          )}

          {/* The working behind the table, not a second version of the line
              above. It used to end by restating the monthly loss, which had
              just been said out loud to the prospect — so the founder read the
              figure, then the call volume, then the same figure again. Labelled
              rather than removed: the minutes are how the package is picked,
              and a bare count of calls under a spoken line reads as more of the
              pitch. */}
          <p className="mt-3.5 text-[13px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">
              For the package:
            </span>{" "}
            about{" "}
            <span className="font-bold text-foreground tabular-nums">
              {Math.round(callsMonthly)} calls
            </span>{" "}
            a month ({calls} × {WEEKS_PER_MONTH} weeks), so roughly{" "}
            <span className="font-bold text-foreground tabular-nums">
              {minutes} minutes
            </span>{" "}
            (at {MINUTES_PER_CALL} min a call).
          </p>

          {/* Every package at their volume, not just the recommended one. A
              founder who quotes the middle tier to somebody using 100 minutes
              is charging $250 where $125 would have done, and a prospect who
              works that out afterwards has caught them overselling. */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1.5 text-left font-bold">Package</th>
                  <th className="px-2 py-1.5 text-left font-bold">Included</th>
                  {/* The included minutes mean nothing to a prospect; the
                      number of calls they cover is the thing they can check
                      against their own week. */}
                  <th className="px-2 py-1.5 text-left font-bold">Covers</th>
                  <th className="px-2 py-1.5 text-left font-bold">
                    At {minutes} min
                  </th>
                  {hasTicket && (
                    <th className="px-2 py-1.5 text-left font-bold">Of loss</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {priced.map(({ pkg, cents }) => {
                  const over =
                    pkg.minutes !== null && minutes > pkg.minutes
                      ? minutes - pkg.minutes
                      : 0;
                  return (
                    <tr
                      key={pkg.id}
                      className={cn(
                        "border-b border-border/60 last:border-b-0",
                        pkg.id === cheapest && "bg-primary/5",
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <span className="font-semibold">{pkg.name}</span>
                        {pkg.id === cheapest && (
                          <span className="ml-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-primary">
                            cheapest
                          </span>
                        )}
                        {pkg.id === noOverage.id && pkg.id !== cheapest && (
                          <span className="ml-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                            no overage
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                        {pkg.minutes === null ? "unlimited" : `${pkg.minutes} min`}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                        {pkg.minutes === null ? (
                          "any volume"
                        ) : (
                          <>
                            {Math.floor(pkg.minutes / MINUTES_PER_CALL)} calls
                            <span className="text-muted-foreground/70">
                              {" "}
                              (~
                              {Math.floor(
                                pkg.minutes / MINUTES_PER_CALL / WEEKS_PER_MONTH,
                              )}
                              /wk)
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        ${money(cents)}
                        {over > 0 && (
                          // The rate, not just the fact of an overrun: "29 over"
                          // says nothing about whether the next tier is cheaper.
                          <span className="text-muted-foreground">
                            {" "}
                            ({over} over @ ${money(pkg.overageCents)}/min)
                          </span>
                        )}
                      </td>
                      {hasTicket && (
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {((cents / lossCents) * 100).toFixed(1)}%
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {cheapest && cheapest !== noOverage.id && (
            // Both facts, so neither can be sold as the other: the cheaper bill
            // and the one with no overage on it are different packages here.
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">
                {PACKAGES.find((p) => p.id === cheapest)!.name}
              </span>{" "}
              is the cheaper bill at this volume;{" "}
              <span className="font-semibold text-foreground">
                {noOverage.name}
              </span>{" "}
              is the one with no overage on it. The pitch for the bigger plan is
              a bill that does not move — not a smaller one.
            </p>
          )}

          {/* The lever to reach for before the trial. */}
          <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-[13px]">
            <p className="font-semibold">If price is the sticking point</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {TERMS.filter((t) => t.discountPct > 0).map((t) => {
                const pick = PACKAGES.find((p) => p.id === cheapest) ?? noOverage;
                const m = monthlyCents(pick, t);
                const total = commitmentCents(pick, t);
                return (
                  <li key={t.id} className="tabular-nums">
                    {t.label}: {pick.name} at{" "}
                    <span className="font-semibold text-foreground">
                      ${money(m)}
                    </span>{" "}
                    a month
                    {total !== null && <> — ${money(total)} over the term</>}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
