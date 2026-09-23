"use client";

import { Phone } from "lucide-react";
import { useCallLine } from "@/components/calls/call-line";
import { cn } from "@/lib/utils";

/**
 * Ring somebody back, right here, from wherever their number is on screen.
 *
 * Not `CallBackButton`, which is a link into the dial card for a lead on a
 * list. This dials in place, which is what a number with no lead — or a text
 * thread — needs, since there is no dial card to link to.
 *
 * Missed calls and Texts used to offer only a copy button, so a caller in the
 * browser copied the number, opened the Keypad, pasted it and dialled — four
 * steps for the warmest call of their day. The phone lives in the app layout
 * (`CallLineProvider`), so a call placed here carries on in the bar at the
 * bottom of the screen and survives moving to another page.
 *
 * - **From the number they rang or texted**, so the call comes from one they
 *   already know.
 * - **Tied to the lead when there is one** (`setActiveLead`), so the outcome
 *   logged afterwards joins the recording, and opening the dialler mid-call
 *   lands on that lead's card rather than the top of the queue.
 * - **Absent, not disabled, when it cannot work**: no browser line (they dial
 *   on a handset), or the number is screened out. The copy button beside it
 *   covers the first and says "Do not call" for the second.
 */
export function RingBackButton({
  to,
  from,
  leadId,
  blocked,
  className,
}: {
  /** Their number, in E.164. */
  to: string;
  /** Ours to ring from. Null means there is nothing to ring from. */
  from: string | null;
  leadId: number | null;
  /** Why this number may not be rung, or null. */
  blocked: string | null;
  className?: string;
}) {
  const { line, live, setActiveLead, startLeg } = useCallLine();
  if (!live || blocked || !from) return null;

  const busy = line.state !== "idle";
  return (
    <button
      type="button"
      disabled={busy || !line.ready}
      onClick={() => {
        // Before dialling, so the first moment of the call already belongs to
        // this lead.
        if (leadId !== null) setActiveLead(leadId);
        // A number with no lead has no outcome to log, so nothing would ever
        // write a row for the call and its recording would belong to nobody —
        // not in Stats, not anywhere. File it the way a Keypad dial is filed.
        else startLeg({ phone: to, label: "Rang back", did: from, ringBack: true });
        line.reset();
        line.dial(to, from);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-success px-3 py-1.5 text-[13px] font-bold text-primary-foreground transition-colors hover:bg-success/85 disabled:opacity-50",
        className,
      )}
    >
      <Phone className="size-3.5" strokeWidth={2.4} />
      {busy ? "On a call" : !line.ready ? "Connecting…" : "Call back"}
    </button>
  );
}
