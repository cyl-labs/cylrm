"use client";

import * as React from "react";
import { PhoneCall } from "lucide-react";
import { useCallLine } from "@/components/calls/call-line";
import { ConfirmCall } from "@/components/calls/confirm-call";
import { cn } from "@/lib/utils";

/**
 * Ring the prospect from the meeting row itself.
 *
 * This replaces a link into the lead's dial card. The diary could not dial when
 * it was built -- the phone lived on that one screen -- and once the line moved
 * into the app layout nobody revisited it, so a demo meant: press Call them,
 * get redirected, press Call again, talk, then come back to the meetings tab to
 * say how it went. The outcome was logged on a different screen from the call,
 * which is exactly how a demo recording ends up attached to nothing.
 *
 * **It explains itself rather than disappearing.** The dial-in-place button on
 * Missed calls returns null when it cannot work, which is right there: a copy
 * button sits beside it and the row still functions. Here the call *is* the
 * row's purpose, so a button that silently is not there reads as the phone
 * being broken -- the same reasoning the dial card uses when another tab holds
 * the line. Two accounts have no number assigned today, and they get a sentence
 * rather than a blank space.
 *
 * **Confirmed before it rings**, unlike the dial card. There you are in a
 * calling rhythm and the press is the point; here you are usually reading -- a
 * time, the booking notes -- and this button sits inches from them. A stray tap
 * rings a real prospect in the middle of their day and cannot be taken back.
 */
export function MeetingCallButton({
  who,
  to,
  from,
  leadId,
  blocked,
  note,
  label,
  className,
}: {
  /** The business, named as the row names it. */
  who: string;
  /** Their number to dial, E.164. Null when it cannot be dialled. */
  to: string | null;
  /** Ours to ring from -- the signed-in person's own number. */
  from: string | null;
  leadId: number | null;
  /** Why this number may not be rung at all, or null. */
  blocked: string | null;
  /** Shown in the confirmation, so the demo time is in front of you. */
  note?: string;
  label: string;
  className?: string;
}) {
  const { line, live, setActiveLead } = useCallLine();
  const [asking, setAsking] = React.useState(false);

  // Screened out. The copy button beside this says "Do not call", so adding a
  // second explanation here would be noise.
  if (blocked) return null;

  const why = !to
    ? "This number cannot be dialled from here."
    : !from
      ? "No number assigned to you yet — an admin sets one on Team."
      : !live
        ? "The phone is open in another CRM tab. Dial from there, or close it and reload this page."
        : null;

  if (why) {
    return (
      <p className="text-[12px] text-muted-foreground">{why}</p>
    );
  }

  const busy = line.state !== "idle";

  return (
    <>
      <button
        type="button"
        disabled={busy || !line.ready}
        onClick={() => setAsking(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50",
          className,
        )}
      >
        <PhoneCall className="size-3.5" strokeWidth={2.2} />
        {busy ? "On a call" : !line.ready ? "Connecting…" : label}
      </button>

      <ConfirmCall
        open={asking}
        who={who}
        to={to!}
        from={from!}
        note={note}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          // Before dialling, so the first moment of the call already belongs to
          // this lead — which is what lets an outcome logged afterwards pick up
          // the recording instead of orphaning it.
          if (leadId !== null) setActiveLead(leadId);
          line.reset();
          line.dial(to!, from!);
        }}
      />
    </>
  );
}
