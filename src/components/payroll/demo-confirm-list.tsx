"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HALF_MEETING_CENTS, MEETING_CENTS, formatMoney } from "@/lib/payroll-rates";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import type { CallOutcome } from "@/lib/calls";
import type { DemoStatus } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { LogRecording } from "@/components/calls/log-recording";
import {
  CallSummariesFold,
  LONG_CALL_MS,
  type CallSummaryItem,
} from "@/components/calls/call-summaries-fold";

export type DemoView = {
  callId: number;
  company: string;
  listName: string;
  callerName: string | null;
  bookedLabel: string;
  notes: string | null;
  status: DemoStatus | null;
  currentOutcome: CallOutcome;
  /**
   * What the calendar says about this booking (2026-10-03), so a row can show
   * when the demo is, whether that time has passed, and let the calls be heard
   * and read from here. Null when the booking has no meeting behind it, which
   * is the case for bookings the Cal.com sync never matched.
   */
  meeting: {
    startLabel: string;
    state: "upcoming" | "passed" | "cancelled";
    coldCall: { recordingId: string; durationMs: number | null; summary: string | null } | null;
    demoCalls: {
      recordingId: string;
      durationMs: number | null;
      startedLabel: string | null;
      summary: string | null;
    }[];
    /** What the founder wrote about the demo itself. */
    attendanceNotes: string | null;
  } | null;
};

/**
 * Did the meeting happen.
 *
 * The one fact the CRM could not already answer, and the only thing that moves
 * a caller's commission. Both answers are one tap, and either can be changed
 * until a payout claims it — after that the API refuses, because that money
 * has gone out and the fix is a correcting payout rather than an edit.
 *
 * A no-show is worth recording rather than leaving blank: it is what tells the
 * founders a booking has been dealt with, and an unanswered list that only
 * ever shrinks by half is one nobody finishes.
 *
 * Answered rows fold away so the list empties as it is worked. They are not
 * gone — the fold says how many there are and opens them for correction — but
 * a worklist that still shows everything you have already dealt with is one
 * you cannot tell you have finished.
 */
export function DemoConfirmList({ demos }: { demos: DemoView[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<number | null>(null);
  const [showAnswered, setShowAnswered] = React.useState(false);

  // The half-fee box open on one row at a time, with the reason being typed.
  const [halfFor, setHalfFor] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState("");

  async function mark(callId: number, status: DemoStatus, notes?: string) {
    setBusy(callId);
    try {
      const res = await fetch("/api/payroll/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(notes === undefined ? { callId, status } : { callId, status, notes }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Could not save that.");
        return;
      }
      setHalfFor(null);
      setReason("");
      router.refresh();
    } catch {
      toast.error("Could not save that.");
    } finally {
      setBusy(null);
    }
  }

  // The two halves do different jobs. Unanswered rows are the worklist and
  // are the whole point of the section; answered ones are a record, and a
  // record that will not go away turns a list you are meant to clear into one
  // that only ever grows. They fold away instead — still one click from being
  // corrected, and still counted in the line that opens them.
  //
  // Neither is lost by folding: a showed-up demo is already money on the
  // "Owed now" table above, which is where an amount belongs.
  const unansweredAll = demos.filter((d) => d.status === null);
  // Split by whether the demo can have happened yet. Nine of eleven "unanswered"
  // rows on 2026-10-03 were demos still in the future, which cannot be answered
  // and made the list read as eleven pieces of overdue work.
  const unanswered = unansweredAll.filter((d) => d.meeting?.state !== "upcoming");
  const notDue = unansweredAll.filter((d) => d.meeting?.state === "upcoming");
  const answered = demos.filter((d) => d.status !== null);
  const [showNotDue, setShowNotDue] = React.useState(false);

  if (demos.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
        No booked demos waiting. Anything already paid for is in the history
        below.
      </p>
    );
  }

  const row = (d: DemoView) => (
    <li
      key={d.callId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{d.company}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {d.callerName ?? "Not attributed"} &middot; {d.listName} &middot;{" "}
          booked {d.bookedLabel}
          {/* Where the lead has got to since. Shown only when it has moved
              on, because "now Demo booked" on a booking is noise — and
              shown at all because this list and the pipeline board
              disagree on purpose: the board carries leads whose *latest*
              call is a booking, this carries every booking ever made. A
              lead since moved to Trial left that column weeks ago and is
              still owed an answer here. Without this the row looks like a
              bug rather than a question. */}
          {d.currentOutcome !== "demo_booked" && (
            <>
              {" "}
              &middot; now{" "}
              <span className="font-semibold text-foreground/70">
                {OUTCOME_LABELS[d.currentOutcome]}
              </span>
            </>
          )}
        </p>
        {d.notes && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground/80">
            {d.notes}
          </p>
        )}
        {/* When the demo is, and whether that time has come. */}
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {d.meeting ? (
            <>
              Demo{" "}
              <span className="font-semibold text-foreground/70">
                {d.meeting.startLabel}
              </span>
              {" "}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold",
                  d.meeting.state === "upcoming"
                    ? "bg-muted text-muted-foreground"
                    : d.meeting.state === "cancelled"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/12 text-primary",
                )}
              >
                {d.meeting.state === "upcoming"
                  ? "Not due yet"
                  : d.meeting.state === "cancelled"
                    ? "Booking cancelled"
                    : "Time has passed"}
              </span>
            </>
          ) : (
            <span className="font-semibold text-foreground/70">
              No meeting on the calendar for this booking
            </span>
          )}
          {" "}&middot; outcome now{" "}
          <span className="font-semibold text-foreground/70">
            {OUTCOME_LABELS[d.currentOutcome]}
          </span>
        </p>
        {d.meeting?.attendanceNotes && (
          <p className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground/80">
            What happened: {d.meeting.attendanceNotes}
          </p>
        )}
        {d.meeting &&
          (d.meeting.coldCall || d.meeting.demoCalls.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {d.meeting.coldCall && (
                <LogRecording
                  recordingId={d.meeting.coldCall.recordingId}
                  recordingMs={d.meeting.coldCall.durationMs}
                  company={d.company}
                  callerName={d.callerName ?? "Caller"}
                  label="Cold call"
                />
              )}
              {d.meeting.demoCalls.map((rec, i) => (
                <LogRecording
                  key={rec.recordingId}
                  recordingId={rec.recordingId}
                  recordingMs={rec.durationMs}
                  startedAt={rec.startedLabel}
                  company={d.company}
                  callerName="Founders"
                  label={i === 0 ? "Demo call" : `Demo call ${i + 1}`}
                />
              ))}
            </div>
          )}
        {d.meeting && <SummaryFold d={d} />}
      </div>

      {d.status !== null && (
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-bold",
            d.status === "showed_up" || d.status === "half_fee"
              ? "bg-primary/12 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {d.status === "showed_up"
            ? `Showed up · ${formatMoney(MEETING_CENTS)}`
            : d.status === "half_fee"
              ? `Half fee · ${formatMoney(HALF_MEETING_CENTS)}`
              : d.status === "no_show"
                ? "No-show"
                : "Not valid"}
        </span>
      )}

      {/* All three stay after an answer, so a mis-tap is corrected by pressing
          another — the same shape the dialler uses, where logging and
          correcting are distinct actions. The current answer is the filled
          button.

          "Not valid" is deliberately its own answer and not a gentler
          no-show: a no-show says a real booking was missed, which is a fact
          about the prospect, while this says the row is not a question — a
          duplicate, a test, or a booking logged against the wrong lead. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {d.status === null && d.meeting?.state === "upcoming" && (
          <span className="text-[11px] text-muted-foreground">
            Answer after the demo
          </span>
        )}
        <Button
          size="sm"
          className={cn(d.status === null && d.meeting?.state === "upcoming" && "hidden")}
          variant={d.status === "showed_up" ? "default" : "outline"}
          disabled={busy === d.callId}
          onClick={() => mark(d.callId, "showed_up")}
          title="They picked up at the booked time and stayed on while the agent was brought in"
        >
          <Check className="size-3.5" strokeWidth={2.5} />
          Showed up
        </Button>
        <Button
          size="sm"
          className={cn(d.status === null && d.meeting?.state === "upcoming" && "hidden")}
          variant={d.status === "no_show" ? "secondary" : "outline"}
          disabled={busy === d.callId}
          onClick={() => mark(d.callId, "no_show")}
        >
          <X className="size-3.5" strokeWidth={2.5} />
          No-show
        </Button>
        <Button
          size="sm"
          variant={d.status === "invalid" ? "secondary" : "ghost"}
          disabled={busy === d.callId}
          onClick={() => mark(d.callId, "invalid")}
          title="Not a real booking: a duplicate, a test, or logged against the wrong lead"
        >
          <Ban className="size-3.5" strokeWidth={2.5} />
          Not valid
        </Button>
        {/* Case by case (2026-10-03): half of the fee for a booking that did not
            happen as booked, for example an owner who asked to be called back
            in several months. Needs a written reason, which is what the payout
            is explained from later. */}
        <Button
          size="sm"
          variant={d.status === "half_fee" || halfFor === d.callId ? "default" : "outline"}
          disabled={busy === d.callId}
          onClick={() => {
            setHalfFor(halfFor === d.callId ? null : d.callId);
            setReason(d.meeting?.attendanceNotes ?? "");
          }}
          title={`Pay half of the fee (${formatMoney(HALF_MEETING_CENTS)}) for an unusual case, with a reason`}
        >
          Half fee
        </Button>
      </div>
      {halfFor === d.callId && (
        <div className="basis-full rounded-md border bg-muted/30 p-3">
          <p className="text-[12px] font-semibold">
            Pay {formatMoney(HALF_MEETING_CENTS)} (half of {formatMoney(MEETING_CENTS)}) for{" "}
            {d.company}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            For a one-off, such as an owner who asked to be rung back in a few
            months so the demo will not happen soon. Say why. It is saved with the
            answer and shown when you pay.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why does this earn a half fee?"
            className="mt-2 w-full rounded-md border bg-background px-2.5 py-1.5 text-[13px]"
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={busy === d.callId || reason.trim() === ""}
              onClick={() => mark(d.callId, "half_fee", reason.trim())}
            >
              Save half fee
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHalfFor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <>
      {unanswered.length > 0 ? (
        <ul className="divide-y divide-border/60">{unanswered.map(row)}</ul>
      ) : (
        <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
          {notDue.length > 0
            ? "Nothing to answer right now. The demos below have not happened yet."
            : "Nothing waiting for an answer."}
        </p>
      )}

      {notDue.length > 0 && (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => setShowNotDue((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/40 sm:px-5"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", showNotDue && "rotate-90")}
              strokeWidth={2.5}
            />
            <span className="font-semibold">
              {notDue.length} not due yet
            </span>
            <span className="text-muted-foreground/70">
              {showNotDue
                ? "hide"
                : "demos that have not happened, so there is nothing to answer"}
            </span>
          </button>
          {showNotDue && (
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {notDue.map(row)}
            </ul>
          )}
        </div>
      )}

      {answered.length > 0 && (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => setShowAnswered((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/40 sm:px-5"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform",
                showAnswered && "rotate-90",
              )}
              strokeWidth={2.5}
            />
            <span className="font-semibold">
              {answered.length} answered, not yet paid
            </span>
            <span className="text-muted-foreground/70">
              {showAnswered ? "hide" : "change an answer"}
            </span>
          </button>
          {showAnswered && (
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {answered.map(row)}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/** The written summaries of this booking's calls, the same fold the Meetings row
 *  uses. A long call with no summary says so and can write one. */
function SummaryFold({ d }: { d: DemoView }) {
  const m = d.meeting;
  if (!m) return null;
  const items: CallSummaryItem[] = [
    ...(m.coldCall
      ? [
          {
            key: `cold-${m.coldCall.recordingId}`,
            recordingId: m.coldCall.recordingId,
            label: "Cold call",
            durationMs: m.coldCall.durationMs,
            text: m.coldCall.summary ?? "",
          },
        ]
      : []),
    ...m.demoCalls.map((r, i) => ({
      key: r.recordingId,
      recordingId: r.recordingId,
      label: i === 0 ? "Demo call" : `Demo call ${i + 1}`,
      durationMs: r.durationMs,
      text: r.summary ?? "",
    })),
  ].filter(
    (x) => x.text.trim() !== "" || (x.durationMs ?? 0) >= LONG_CALL_MS,
  );
  return <CallSummariesFold items={items} />;
}
