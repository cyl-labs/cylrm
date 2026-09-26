import * as React from "react";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import {
  MEETING_CENTS,
  PICKUPS_PER_BONUS,
  PICKUP_BONUS_CENTS,
  byWeek,
  formatMoney,
  formatPayDay,
  formatPayWeek,
  getDemosToConfirm,
  getPayoutHistory,
  getPayroll,
  getUnpaidMeetings,
} from "@/lib/payroll";
import { getPayrollReminderSetting } from "@/lib/payroll-reminder";
import { PayrollTable } from "@/components/payroll/payroll-table";
import { DemoConfirmList } from "@/components/payroll/demo-confirm-list";
import { ReminderScheduleCard } from "@/components/calls/reminder-schedule";
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

  const [rows, demos, history, reminder, unpaidMeetings] = await Promise.all([
    getPayroll(),
    getDemosToConfirm(),
    getPayoutHistory(),
    getPayrollReminderSetting(),
    getUnpaidMeetings(),
  ]);

  const owedTotal = rows.reduce((sum, r) => sum + r.totalCents, 0);
  // The two halves of that total, the way the two buttons pay them.
  const owedPickups = rows.reduce(
    (sum, r) => sum + r.pickupBonusCents + r.bankedBonusCents,
    0,
  );
  const owedMeetings = rows.reduce((sum, r) => sum + r.meetingCommissionCents, 0);
  const owedMeetingCount = rows.reduce((sum, r) => sum + r.meetings, 0);
  const pickupPeople = rows.filter(
    (r) => r.pickupBonusCents + r.bankedBonusCents > 0,
  ).length;
  const unanswered = demos.filter((d) => d.status === null).length;
  const weeks = byWeek(history);

  // Dates are formatted here and handed down as text. The two components
  // below are client components, and a date rendered in the browser's own zone
  // would disagree with the server's — the hydration mismatch `leads-grid.tsx`
  // pins its locale to avoid. Pinning the zone in one server-side file instead
  // means neither of them has to know there is a zone at all.
  const rowsWithLabels = rows.map((r) => ({
    ...r,
    // The counter starts at the last payment *or* reset, whichever came
    // later, so the label has to name the one that actually applies. It said
    // "Since <last paid>" for both until resets could bank money (2026-09-20),
    // which on a reset row named a date the count did not start on.
    periodLabel: (() => {
      const cut =
        r.lastResetAt && (!r.lastPaidAt || r.lastResetAt > r.lastPaidAt)
          ? r.lastResetAt
          : null;
      if (cut) {
        // Both facts where both are true: a reset says what the count is
        // measured from, "never paid" says nothing has been settled yet, and
        // dropping either one hides something somebody needs on a Friday.
        return r.lastPaidAt
          ? `Reset ${formatPayDay(cut)}`
          : `Never paid · reset ${formatPayDay(cut)}`;
      }
      return r.lastPaidAt ? `Since ${formatPayDay(r.lastPaidAt)}` : "Never paid";
    })(),
    // Which meetings "Pay meetings" is paying for, named in its confirmation.
    meetingList: unpaidMeetings
      .filter((m) => m.userId === r.userId)
      .map((m) => ({
        leadId: m.leadId,
        company: m.company,
        listName: m.listName,
        bookedLabel: formatPayDay(m.bookedAt),
        markedLabel: formatPayDay(m.markedAt),
        contact: m.contact,
        meetingNotes: m.meetingNotes,
        bookingNotes: m.bookingNotes,
      })),
  }));
  const demosWithLabels = demos.map((d) => ({
    ...d,
    bookedLabel: formatPayDay(d.bookedAt),
  }));

  return (
    <PageShell title="Payroll">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
        <p className="text-[13px] text-muted-foreground">
          {/* Read off the constants rather than written out, so the sentence
              cannot go on claiming a rate nobody is paid any more. */}
          Pickups counted since each person was last paid or reset, at{" "}
          <span className="font-semibold text-foreground">
            {formatMoney(PICKUP_BONUS_CENTS)} per {PICKUPS_PER_BONUS}
          </span>
          . Meetings that showed up at{" "}
          <span className="font-semibold text-foreground">
            {formatMoney(MEETING_CENTS)} each
          </span>,
          however long ago they were booked. Showed up means they picked up at
          the booked time and stayed on while the agent was brought in. Most
          owed first. The two are paid separately, and paying the meetings
          leaves the pickup counter running. Nothing here pays anybody. Press
          a button once the money has actually gone out.
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
            {/* How the total splits, since the two halves are paid by
                separate buttons on separate days. Pickups include bonus a
                reset banked, exactly as "Pay pickups" does. */}
            <dl className="ml-auto flex flex-wrap items-end gap-x-6 gap-y-2 text-right">
              {[
                {
                  label: "Pickups",
                  cents: owedPickups,
                  sub: `${pickupPeople} ${pickupPeople === 1 ? "person" : "people"}`,
                },
                {
                  label: "Meetings",
                  cents: owedMeetings,
                  sub: `${owedMeetingCount} ${owedMeetingCount === 1 ? "meeting" : "meetings"}`,
                },
              ].map((s) => (
                <div key={s.label}>
                  <dt className="text-[11px] font-medium text-muted-foreground">
                    {s.label}
                  </dt>
                  <dd className="text-sm font-bold tabular-nums">
                    {formatMoney(s.cents)}
                    <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                      {s.sub}
                      {owedTotal > 0 &&
                        ` · ${Math.round((s.cents / owedTotal) * 100)}%`}
                    </span>
                  </dd>
                </div>
              ))}
              <div className="border-l border-border/60 pl-6">
                <dt className="text-[11px] font-medium text-muted-foreground">
                  Total
                </dt>
                <dd className="text-sm font-extrabold tabular-nums">
                  {formatMoney(owedTotal)}
                </dd>
              </div>
            </dl>
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
              {/* Says why this is longer than the board's Demo booked column.
                  The board shows leads whose *latest* call is a booking; this
                  shows every booking ever made, because a lead that has since
                  moved to Trial or Lost was still a meeting somebody booked
                  and may still be owed for. */}
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                Every demo ever booked, not just the ones still sitting in the
                pipeline&rsquo;s Demo booked column. A lead that has moved on
                since was still a meeting, and still earns the $30 if they
                turned up. Nothing earns it until it is marked.
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
                        <React.Fragment key={p.id}>
                        <tr className="border-b border-border/60 last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                            {formatPayDay(p.paidAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 font-semibold">
                            {p.name}
                            {/* A reset moved the counter and paid nothing.
                                Said on the row rather than left to be inferred
                                from a $0 total, because "84 pickups, $0" in a
                                table headed "what was actually paid" reads as
                                a bug unless something says otherwise. */}
                            {p.kind === "reset" && (
                              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                                Counter reset
                              </span>
                            )}
                            {/* Which half it settled. Said out loud for the
                                same reason the reset badge is: "$90, 0
                                pickups" in a table headed "what was actually
                                paid" reads as a bug unless something says the
                                pickups were never part of it. */}
                            {(p.kind === "pickups" || p.kind === "meetings") && (
                              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                                {p.kind === "pickups"
                                  ? "Pickups only"
                                  : "Meetings only"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {p.pickups.toLocaleString()}
                            {p.kind === "reset" && (
                              <span className="ml-1 text-[11px]">cleared</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {p.kind === "reset" ? "-" : formatMoney(p.pickupBonusCents)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {p.kind === "reset" ? "-" : p.meetings}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {p.kind === "reset" ? "-" : formatMoney(p.meetingCommissionCents)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                            {p.kind === "reset" ? (
                              <span className="font-medium text-muted-foreground">
                                no payment
                              </span>
                            ) : (
                              formatMoney(p.totalCents)
                            )}
                          </td>
                        </tr>
                        {/* Which demos the commission was for. A second row
                            rather than a cell, so the seven columns above stay
                            a grid and the figures keep lining up down the whole
                            history — the reason the week header is a row too.
                            Only where there were any: a pickup-only payment
                            and a counter reset both have none, and an empty
                            "paid for" line under them would read as something
                            missing. */}
                        {p.demos.length > 0 && (
                          <tr className="border-b border-border/60 last:border-0">
                            <td />
                            <td
                              colSpan={6}
                              className="px-4 pb-2.5 text-[11px] text-muted-foreground"
                            >
                              <span className="font-semibold">
                                {formatMoney(MEETING_CENTS)} each for
                              </span>{" "}
                              {p.demos
                                .map((d) => `${d.company} (booked ${formatPayDay(d.bookedAt)})`)
                                .join(", ")}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* When to be told it is payday. At the foot because it is a setting
            rather than work — what is owed is the top of this screen, and this
            is only how you stop finding out about it late. */}
        <div className={CARD}>
          <div className="border-b border-border/60 px-5 py-3.5">
            <p className="text-sm font-extrabold tracking-[-0.01em]">
              Payday reminder
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/75">
              A notification to the founders with what everybody is owed.
            </p>
          </div>
          <ReminderScheduleCard
            which="payroll"
            initial={reminder}
            carries="with what everybody is owed"
            offNote="Switched off. Nothing will tell you it is payday. What is owed is still on this screen whenever you open it."
          />
        </div>
      </div>
    </PageShell>
  );
}
