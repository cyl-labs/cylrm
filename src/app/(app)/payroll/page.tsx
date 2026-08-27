import * as React from "react";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import {
  byWeek,
  formatMoney,
  formatPayDay,
  formatPayWeek,
  getDemosToConfirm,
  getPayoutHistory,
  getPayroll,
} from "@/lib/payroll";
import { PayrollTable } from "@/components/payroll/payroll-table";
import { DemoConfirmList } from "@/components/payroll/demo-confirm-list";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CARD = "rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]";

/**
 * What the floor is owed, and what has been handed over.
 *
 * Reads the same `call` rows Stats does — `PICKUP` is imported from
 * `call-stats.ts` rather than restated, so the number people are paid on is
 * the number they can see on Stats — and adds one fact of its own: whether a
 * booked meeting actually happened. Nothing else in the app records that.
 *
 * Manual throughout. Nothing resets on a timer, nothing pays anybody, and a
 * counter goes back to zero only when someone presses the button.
 */
export default async function PayrollPage() {
  const me = await getCurrentUser();
  // `ADMIN_ONLY_CALL_PREFIXES` already has the middleware turn a caller away.
  // Repeated here because this page renders what everyone earns, and a guard
  // on one side of a redirect is a guard that can be moved by an edit to a
  // list in another file.
  if (me?.role !== "admin") redirect("/calls");

  const [rows, demos, history] = await Promise.all([
    getPayroll(),
    getDemosToConfirm(),
    getPayoutHistory(),
  ]);

  const owedTotal = rows.reduce((sum, r) => sum + r.totalCents, 0);
  const unanswered = demos.filter((d) => d.showedUp === null).length;
  const weeks = byWeek(history);

  // Dates are formatted here and handed down as text. The two components
  // below are client components, and a date rendered in the browser's own zone
  // would disagree with the server's — the hydration mismatch `leads-grid.tsx`
  // pins its locale to avoid. Pinning the zone in one server-side file instead
  // means neither of them has to know there is a zone at all.
  const rowsWithLabels = rows.map((r) => ({
    ...r,
    periodLabel: r.lastPaidAt
      ? `Since ${formatPayDay(r.lastPaidAt)}`
      : "Never paid",
  }));
  const demosWithLabels = demos.map((d) => ({
    ...d,
    bookedLabel: formatPayDay(d.bookedAt),
  }));

  return (
    <PageShell title="Payroll">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
        <p className="text-[13px] text-muted-foreground">
          Pickups counted since each person was last paid, at{" "}
          <span className="font-semibold text-foreground">$20 per 50</span>.
          Meetings that showed up at{" "}
          <span className="font-semibold text-foreground">$30 each</span>,
          however long ago they were booked. Nothing here pays anybody — press
          the button once the money has actually gone out.
        </p>

        {/* Owed now. The button at the end of each row is the only thing on
            this screen that writes a payout. */}
        <div className={CARD}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-5 py-3.5">
            <div>
              <p className="text-sm font-extrabold tracking-[-0.01em]">
                Owed now
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                Since each person&rsquo;s last payout.
              </p>
            </div>
            <p className="ml-auto text-right text-sm font-extrabold tabular-nums">
              {formatMoney(owedTotal)}
              <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                total
              </span>
            </p>
          </div>
          <PayrollTable rows={rowsWithLabels} />
        </div>

        {/* Did the meeting happen. The commission column above cannot move
            until a question here is answered, so this sits directly under it
            rather than at the bottom of the page. */}
        <div className={CARD}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-5 py-3.5">
            <div>
              <p className="text-sm font-extrabold tracking-[-0.01em]">
                Meetings to confirm
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                Booked demos. Nothing earns the $30 until it is marked as
                having shown up.
              </p>
            </div>
            {unanswered > 0 && (
              <p className="ml-auto rounded-full bg-primary/12 px-2.5 py-1 text-[11px] font-bold text-primary">
                {unanswered} unanswered
              </p>
            )}
          </div>
          <DemoConfirmList demos={demosWithLabels} />
        </div>

        {/* Payout history, by the week each payment was made in. */}
        <div className={CARD}>
          <div className="border-b border-border/60 px-5 py-3.5">
            <p className="text-sm font-extrabold tracking-[-0.01em]">
              Payout history
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              What was actually paid, and the basis at the time. Recorded once
              and never recalculated.
            </p>
          </div>
          {weeks.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              No payouts recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border/60 text-left">
                    {["Paid", "Person", "Pickups", "Bonus", "Meetings", "Commission", "Total"].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={cn(
                            "whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                            i > 1 && "text-right",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    // A fragment per week rather than a nested table, so every
                    // column stays in one grid and the figures line up down
                    // the whole history.
                    <React.Fragment key={week.weekStart}>
                      <tr className="border-b border-border/60 bg-muted/40">
                        <td
                          colSpan={6}
                          className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground"
                        >
                          Week of {formatPayWeek(week.weekStart)}
                        </td>
                        <td className="px-4 py-1.5 text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                          {formatMoney(week.totalCents)}
                        </td>
                      </tr>
                      {week.rows.map((p) => (
                        <tr key={p.id} className="border-b border-border/60 last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                            {formatPayDay(p.paidAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 font-semibold">
                            {p.name}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {p.pickups.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatMoney(p.pickupBonusCents)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {p.meetings}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {formatMoney(p.meetingCommissionCents)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                            {formatMoney(p.totalCents)}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
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
