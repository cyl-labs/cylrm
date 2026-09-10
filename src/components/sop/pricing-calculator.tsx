"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PACKAGES,
  TERMS,
  commitmentCents,
  money,
  monthlyCents,
  type Package,
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
 * The two rules of thumb are the calculator's own and are stated in the
 * document beside it: **two minutes a call**, and a month is 4.33 weeks. If
 * either changes, it changes in both places.
 */

/** What an answered call runs to. The whole estimate hangs off this one
 *  number, so it is named rather than buried in an expression. */
const MINUTES_PER_CALL = 2;
/** Weeks in a month. 4.33 rather than 4: over a year the difference is a
 *  fortnight of calls, which is enough to move somebody a tier. */
const WEEKS_PER_MONTH = 4.33;

/** What this package would actually cost at that many minutes — the included
 *  price plus whatever overage the volume runs into. Unlimited never overruns
 *  by definition. */
function costAt(pkg: Package, minutes: number): number {
  if (pkg.minutes === null) return pkg.monthlyCents;
  const over = Math.max(0, minutes - pkg.minutes);
  return pkg.monthlyCents + over * pkg.overageCents;
}

export function PricingCalculator() {
  // Blank rather than pre-filled: a number already in the box gets read out as
  // though the prospect said it.
  const [callsPerWeek, setCallsPerWeek] = React.useState("");
  const [ticket, setTicket] = React.useState("");

  const calls = Number(callsPerWeek);
  const job = Number(ticket);
  const hasCalls = callsPerWeek.trim() !== "" && Number.isFinite(calls) && calls > 0;
  const hasTicket = ticket.trim() !== "" && Number.isFinite(job) && job > 0;

  const callsMonthly = hasCalls ? calls * WEEKS_PER_MONTH : 0;
  const minutes = Math.round(callsMonthly * MINUTES_PER_CALL);
  // What they are losing, in cents, to keep every figure in the same unit.
  const lossCents = hasCalls && hasTicket ? Math.round(callsMonthly * job * 100) : 0;

  const priced = PACKAGES.map((p) => ({ pkg: p, cents: costAt(p, minutes) }));
  const cheapest = hasCalls
    ? priced.reduce((a, b) => (b.cents < a.cents ? b : a)).pkg.id
    : null;
  /**
   * The smallest package that covers them with no overage at all.
   *
   * Shown as a fact, never as the recommendation. Marking it "fits" and
   * highlighting it was actively wrong: at thirty missed calls a week it
   * pointed at Call Commander's $2,000 while Phone Professional would have
   * billed $271 for the same month.
   */
  const noOverage =
    PACKAGES.find((p) => p.minutes === null || minutes <= p.minutes) ?? PACKAGES[0];

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
          <p className="mt-3.5 text-[13px] leading-relaxed">
            About{" "}
            <span className="font-bold">{Math.round(callsMonthly)} calls</span> a
            month{" "}
            {/* Said out loud because 10 a week reading as 43 a month looks
                like a bug otherwise. 52 weeks over 12 months is 4.33, not 4 —
                rounding to 4 loses a month of calls across a year. */}
            <span className="text-muted-foreground">
              ({calls} × {WEEKS_PER_MONTH} weeks)
            </span>
            , so roughly{" "}
            <span className="font-bold tabular-nums">{minutes} minutes</span>{" "}
            <span className="text-muted-foreground">
              (at {MINUTES_PER_CALL} min a call)
            </span>
            .
            {hasTicket && (
              <>
                {" "}
                At ${job.toLocaleString()} a job that is{" "}
                <span className="font-bold tabular-nums">
                  ${money(lossCents)}
                </span>{" "}
                a month walking out of the door.
              </>
            )}
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
