import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { RefreshSpend } from "@/components/calls/refresh-spend";
import { getSpend, SPEND_DAYS } from "@/lib/telnyx-usage";
import { getCallTotals } from "@/lib/call-stats";
import { countShowedUpDemos } from "@/lib/payroll";
import { usdToSgd } from "@/lib/fx";
import { MEETING_CENTS, pickupBonusCents } from "@/lib/payroll-rates";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * What the phones cost, and what that buys.
 *
 * Admin-only — it is the bank balance and everyone's line usage, which is the
 * same material Payroll and Team are closed for. Enforced by
 * `ADMIN_ONLY_CALL_PREFIXES` in the middleware; this page is not the control.
 *
 * The screen exists because the answer was otherwise two logins away, on a
 * portal nobody opens, in a product vocabulary ("sip-trunking") that does not
 * say which of these is the caller's leg and which is the prospect's. The
 * numbers were never hard to get; they were hard to *ask for*.
 *
 * Everything is one thirty-day window. A range picker was deliberately left
 * off: the figures here are read a handful of times a month to answer "are we
 * fine", and a control that can put the screen into a state where it disagrees
 * with the last time you looked is a cost with no matching benefit.
 */

/**
 * Money, in whichever currency the screen is set to.
 *
 * Built per render rather than as a module constant because it closes over the
 * rate. Every figure that comes off Telnyx is USD underneath; the symbol is
 * never omitted, so a converted screen cannot be mistaken for a dollar one in
 * a screenshot.
 */
function formatter(symbol: string, rate: number) {
  const money = (n: number, places = 2) =>
    `${symbol}${(n * rate).toLocaleString("en-US", {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    })}`;
  return {
    money,
    // Per-unit costs are fractions of a cent, so they get three places —
    // $0.015 is the answer, $0.02 is a rounding of it and $0.00 is a lie.
    unit: (n: number) => (n > 0 ? money(n, 3) : "—"),
  };
}

/** A filter chip, the shape the rest of the calling screens use. */
function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

const CARD =
  "rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]";

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string; demos?: string }>;
}) {
  const params = await searchParams;
  // Both toggles live in the URL rather than in a preference, like every other
  // filter on the calling side: a link then carries what its sender was
  // looking at, and there is no stored setting to disagree with the screen.
  const inSgd = params.currency === "sgd";
  const byAttendance = params.demos === "showed";

  const [spend, totals, showedUp, fx] = await Promise.all([
    getSpend(),
    getCallTotals({ kind: "rolling", days: SPEND_DAYS }),
    countShowedUpDemos(SPEND_DAYS),
    inSgd ? usdToSgd() : Promise.resolve(null),
  ]);

  // Asked for Singapore dollars and the rate would not come: stay in USD
  // rather than inventing one, and say so below.
  const rate = inSgd ? fx : null;
  const { money, unit } = formatter(rate ? "S$" : "$", rate?.rate ?? 1);

  if (spend.skipped === "unconfigured") {
    return (
      <PageShell title="Spend">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-7">
          <div className="rounded-[14px] border border-dashed py-16 text-center">
            <p className="text-sm font-semibold">No spend to show.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Telnyx is not connected on this server, so there is nothing to
              read. Set <code className="font-mono text-[12px]">TELNYX_API_KEY</code>{" "}
              and this screen fills itself in.
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  // The chain from money to outcome. Guarded against a zero denominator: a
  // quiet month must render "—" rather than Infinity.
  const perCall = totals.calls > 0 ? spend.total / totals.calls : 0;
  const perPickup = totals.pickups > 0 ? spend.total / totals.pickups : 0;
  const demoCount = byAttendance ? showedUp : totals.demos;
  const perDemo = demoCount > 0 ? spend.total / demoCount : 0;

  // What the floor accrued over the same window, so the telephony figure is
  // read in proportion rather than in isolation. Pickups pay per whole block,
  // which is why this floors rather than divides — it is the sum Payroll
  // actually pays, not a rate times a count.
  const pickupPay = pickupBonusCents(totals.pickups) / 100;
  const demoFee = MEETING_CENTS / 100;

  const busiest = Math.max(...spend.daily.map((d) => d.cost), 0.01);
  const lineTotal = spend.lines.reduce((a, l) => a + l.cost, 0);

  return (
    <PageShell title="Spend" actions={<RefreshSpend />}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-7">
        {/* Said at the top rather than discovered: a screen showing yesterday's
            figures without saying so is worse than one that is honest about
            being an hour old. */}
        {spend.error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]">
            <span className="font-bold text-destructive">
              Could not reach Telnyx just now.
            </span>{" "}
            <span className="text-muted-foreground">
              These are the last figures we pulled. Press Refresh to try again.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Show in
            </span>
            <Chip href="/spend" active={!inSgd}>
              USD
            </Chip>
            <Chip href="/spend?currency=sgd" active={inSgd}>
              SGD
            </Chip>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Cost per demo
            </span>
            <Chip
              href={inSgd ? "/spend?currency=sgd" : "/spend"}
              active={!byAttendance}
            >
              Booked
            </Chip>
            <Chip
              href={
                inSgd ? "/spend?currency=sgd&demos=showed" : "/spend?demos=showed"
              }
              active={byAttendance}
            >
              Showed up
            </Chip>
          </div>
        </div>

        {/* Said wherever a converted figure appears, never assumed: the bill is
            in US dollars and this screen is the only place that is not
            obvious. */}
        {inSgd && rate && (
          <p className="text-[12px] text-muted-foreground">
            Converted from US dollars at{" "}
            <span className="font-semibold tabular-nums text-foreground">
              1 USD = {rate.rate.toFixed(4)} SGD
            </span>
            , taken {rate.at}. Telnyx bills in USD.
          </p>
        )}
        {inSgd && !rate && (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-[13px]">
            <span className="font-bold">Showing US dollars.</span>{" "}
            <span className="text-muted-foreground">
              The exchange rate could not be fetched, and a made-up rate on a
              bill is worse than the currency it was billed in.
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className={`${CARD} px-4 py-3`}>
            <p className="text-xs font-semibold text-muted-foreground">
              Telnyx balance
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
              {spend.balance === null ? "—" : money(spend.balance)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              {spend.daysLeft === null
                ? "no burn to measure yet"
                : `about ${Math.round(spend.daysLeft)} days at this rate`}
            </p>
          </div>

          <div className={`${CARD} px-4 py-3`}>
            <p className="text-xs font-semibold text-muted-foreground">
              Spent, {SPEND_DAYS} days
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
              {money(spend.total)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              {money(spend.perDay)} a day
            </p>
          </div>

          <div className={`${CARD} px-4 py-3`}>
            <p className="text-xs font-semibold text-muted-foreground">Minutes</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
              {Math.round(spend.minutes).toLocaleString()}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              over {spend.calls.toLocaleString()} connected calls
            </p>
          </div>

          <div className={`${CARD} px-4 py-3`}>
            <p className="text-xs font-semibold text-muted-foreground">Per call</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
              {unit(perCall)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              {totals.calls.toLocaleString()} logged in the CRM
            </p>
          </div>

          <div className={`${CARD} px-4 py-3`}>
            <p className="text-xs font-semibold text-muted-foreground">
              Per pickup
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
              {unit(perPickup)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              {totals.pickups.toLocaleString()} pickups
            </p>
          </div>

          <div className={`${CARD} px-4 py-3`}>
            <p className="text-xs font-semibold text-muted-foreground">
              {byAttendance ? "Per demo that showed" : "Per booked demo"}
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-[-0.02em]">
              {perDemo > 0 ? money(perDemo) : "—"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              {byAttendance
                ? `${showedUp} turned up`
                : `${totals.demos} booked`}
            </p>
          </div>
        </div>

        {/* The proportion, in words. Every other screen here explains what its
            numbers mean rather than leaving a ratio to be worked out, and this
            is the one that stops a $17 phone bill reading as a problem. */}
        {pickupPay > 0 && (
          <p className="text-[13px] text-muted-foreground">
            Telephony is the small half of what a call costs. The floor accrued{" "}
            <span className="font-bold text-foreground">{money(pickupPay)}</span>{" "}
            in pickup bonuses over the same {SPEND_DAYS} days, before the{" "}
            <span className="font-bold text-foreground">{money(demoFee)}</span>{" "}
            each attended demo pays.
          </p>
        )}

        {/* One series, so one colour and no legend — the heading names it.
            Bars sit on the baseline with rounded data-ends; a day with no
            calling keeps a muted stub, because an empty bar and a missing day
            look identical and mean different things. */}
        <div className={`${CARD} px-4 py-4 sm:px-5`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
              What you spent, day by day
            </p>
            <p className="ml-auto text-[12px] text-muted-foreground">
              Busiest day{" "}
              <span className="font-bold tabular-nums text-foreground">
                {money(busiest)}
              </span>
            </p>
          </div>

          <div className="mt-3.5 flex gap-2.5">
            <div className="flex w-8 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground/75">
              {/* The real maximum, not a round number above it: the top bar
                  touches this line, so a label reading $3 over a $2.61 bar is
                  simply wrong. Two places until the numbers get big enough
                  that the cents are noise. */}
              <span>{money(busiest, busiest < 10 ? 2 : 0)}</span>
              <span>{money(busiest / 2, busiest < 10 ? 2 : 0)}</span>
              <span>$0</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex h-[150px] items-end gap-[3px] border-b sm:gap-1.5">
                {spend.daily.map((d) => (
                  <div
                    key={d.date}
                    className="flex h-full flex-1 flex-col justify-end"
                    // Native tooltip rather than a hover card: this is a
                    // founders' screen read once a week, and a bespoke
                    // tooltip layer is a lot of surface for that.
                    title={`${d.date} · ${money(d.cost)}`}
                  >
                    <div
                      className={
                        d.cost > 0
                          ? "min-h-[2px] rounded-t-[4px] bg-primary"
                          : "min-h-[2px] rounded-t-[4px] bg-border"
                      }
                      style={{ height: `${(d.cost / busiest) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/75">
                <span>{spend.daily[0]?.date.slice(5)}</span>
                <span>{spend.daily[spend.daily.length - 1]?.date.slice(5)}</span>
              </div>
            </div>
          </div>

          <p className="mt-2.5 text-[12px] text-muted-foreground">
            The flat days are weekends. Nothing is dialled, so nothing is billed.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          {/* Where it goes */}
          <div className={`${CARD} overflow-hidden`}>
            <p className="px-4 pt-3.5 pb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground sm:px-5">
              Where it goes
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-y">
                    <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground sm:px-5">
                      Product
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                      Used
                    </th>
                    <th className="px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground sm:px-5">
                      Cost
                    </th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody>
                  {spend.products.map((p) => {
                    // A product Telnyx knows about but we have not used yet —
                    // texting, before the campaign clears. Dashed and muted so
                    // it reads as not-yet rather than as broken.
                    const idle = p.cost === 0 && p.used === 0;
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border/60 last:border-b-0"
                      >
                        <td className="px-4 py-2 sm:px-5">
                          <span
                            className={
                              idle ? "font-semibold text-muted-foreground" : "font-semibold"
                            }
                          >
                            {p.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {idle
                            ? "—"
                            : p.unit === "minutes"
                              ? `${Math.round(p.used).toLocaleString()} min`
                              : Math.round(p.used).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums sm:px-5">
                          {idle ? (
                            <span className="font-normal text-muted-foreground/75">
                              —
                            </span>
                          ) : (
                            money(p.cost)
                          )}
                        </td>
                        <td className="py-2 pr-4 sm:pr-5">
                          {idle ? (
                            <div className="h-1.5 rounded-full border border-dashed" />
                          ) : (
                            <div className="h-1.5 rounded-full bg-muted">
                              <div
                                className="h-1.5 rounded-full bg-primary"
                                style={{
                                  width: `${spend.total > 0 ? (p.cost / spend.total) * 100 : 0}%`,
                                }}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Who spends it */}
          <div className={`${CARD} overflow-hidden`}>
            <p className="px-4 pt-3.5 pb-2.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground sm:px-5">
              Who spends it
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-y">
                    <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground sm:px-5">
                      Line
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                      Calls
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                      Minutes
                    </th>
                    <th className="px-4 py-2 text-right text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground sm:px-5">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {spend.lines.map((l) => (
                    <tr
                      key={l.label}
                      className="border-b border-border/60 last:border-b-0"
                    >
                      <td className="px-4 py-2 sm:px-5">
                        <span className="font-semibold">{l.label}</span>
                        {/* A connection nobody holds still bills. Naming it as
                            unheld is the point: it is the one row here that is
                            a question rather than a figure. */}
                        {l.who === null && (
                          <span className="text-muted-foreground">
                            {" "}
                            · nobody holds it
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {l.calls.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {Math.round(l.minutes).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums sm:px-5">
                        {money(l.cost)}
                      </td>
                    </tr>
                  ))}
                  {spend.lines.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center text-[13px] text-muted-foreground sm:px-5"
                      >
                        No calls billed in the last {SPEND_DAYS} days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Reconciles the two tables when they disagree, which they will:
                only outbound legs carry a connection, so this total is the
                voice line rather than the whole bill. */}
            {spend.lines.length > 0 && (
              <p className="px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5">
                {money(lineTotal)} of the {money(spend.total)} is calls out. The
                rest is the browser legs and recording, which belong to no one
                line.
              </p>
            )}
          </div>
        </div>

        {byAttendance && (
          <p className="text-[12px] text-muted-foreground">
            &ldquo;Showed up&rdquo; counts the demos a founder has marked as
            attended on Payroll, dated by the call that booked them. A demo
            nobody has answered for yet is not in it, so this figure only ever
            falls as the confirm list is worked through.
          </p>
        )}
        <p className="text-[12px] text-muted-foreground/75">
          Figures come from Telnyx&rsquo;s own usage reports, cached for an hour
          — press Refresh to pull them again. Deepgram transcription is billed
          separately and is not counted here.
        </p>
      </div>
    </PageShell>
  );
}
