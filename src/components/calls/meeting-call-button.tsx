"use client";

import * as React from "react";
import {
  Grid3x3,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  UserPlus,
} from "lucide-react";
import { useCallLine } from "@/components/calls/call-line";
import { PhoneElsewhere } from "@/components/calls/phone-elsewhere";
import { ConfirmCall } from "@/components/calls/confirm-call";
import { TonePad } from "@/components/calls/tone-pad";
import { Button } from "@/components/ui/button";
import {
  LinePair,
  MergeControls,
  SavedLineList,
  mmss,
  type SavedLine,
} from "@/components/calls/second-line";
import { e164 } from "@/lib/phone";
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
  rowKey,
  blocked,
  note,
  label,
  lines: linesProp,
  className,
}: {
  /** The business, named as the row names it. */
  who: string;
  /** Their number to dial, E.164. Null when it cannot be dialled. */
  to: string | null;
  /** Ours to ring from -- the signed-in person's own number. */
  from: string | null;
  leadId: number | null;
  /** Identifies this row across a navigation — "meeting:12" or "inbound:34".
   *  What the row claims while it is on the call, so it can find its own call
   *  again after the component has been unmounted and remounted. */
  rowKey: string;
  /** Why this number may not be rung at all, or null. */
  blocked: string | null;
  /** Shown in the confirmation, so the demo time is in front of you. */
  note?: string;
  label: string;
  /** The labelled lines worth a button — the voice agent's demo number among
   *  them. Empty means no "Add call", as on the dial card. */
  lines?: SavedLine[];
  className?: string;
}) {
  const lines = linesProp ?? [];
  const { line, live, setActiveLead, activeRowKey, setActiveRow } =
    useCallLine();
  const [asking, setAsking] = React.useState(false);
  /**
   * This row is the one on the call.
   *
   * Held here rather than read off `activeLeadId`, which is the *lead* and
   * would put the controls on both rows of a prospect who booked twice — and
   * on none at all for a booking that matched no lead.
   */
  /**
   * This row is the one on the call.
   *
   * Read from the provider rather than held here. As local state a navigation
   * threw it away: walking to another screen mid-call and back left the row
   * showing a disabled "On a call" button with no way to merge the agent in,
   * because it no longer knew the call was its own.
   */
  const dialled = activeRowKey === rowKey;
  const [adding, setAdding] = React.useState(false);
  const [secondName, setSecondName] = React.useState<string | null>(null);
  const [padOpen, setPadOpen] = React.useState(false);
  // Cleared when the call ends, during render rather than in an effect —
  // React's own way of adjusting state when something it derives from changes.
  // `dialled` clears itself: the provider drops `activeMeetingId` when the
  // call ends. Only this row's own scratch state needs resetting.
  if (!dialled && (adding || secondName !== null || padOpen)) {
    setAdding(false);
    setSecondName(null);
    setPadOpen(false);
  }

  // Screened out. The copy button beside this says "Do not call", so adding a
  // second explanation here would be noise.
  if (blocked) return null;

  const why = !to
    ? "This number cannot be dialled from here."
    : !from
      ? "No number assigned to you yet. An admin sets one on Team."
      : null;

  if (why) {
    return (
      <p className="text-[12px] text-muted-foreground">{why}</p>
    );
  }
  // Another tab has the phone: say why, and offer to bring it here.
  if (!live) {
    return (
      <p className="text-[12px] text-muted-foreground">
        <PhoneElsewhere />
      </p>
    );
  }

  const busy = line.state !== "idle";

  /**
   * The call, once it is this row's.
   *
   * It shipped as a button and nothing else: a founder rang a prospect from
   * here, wanted to put the voice agent on the line, and had no way to — the
   * merge lived only on the dial card and the Keypad. So the demo, which is the
   * whole point of this screen, had to be run from somewhere else.
   *
   * The same pieces those two screens use (`second-line.tsx`), so the hold and
   * the merge behave identically wherever you dial from.
   */
  if (dialled && busy) {
    if (line.second) {
      return (
        <div className="w-full space-y-2">
          <LinePair
            line={line}
            firstLabel={who}
            secondLabel={secondName || "Second call"}
          />
          <MergeControls line={line} />
        </div>
      );
    }
    return (
      <div className="w-full space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-muted/40 text-sm font-bold">
            {line.state === "active" ? (
              <span className="tabular-nums">{mmss(line.seconds)}</span>
            ) : (
              <span className="text-muted-foreground">
                {line.state === "ringing" ? "Ringing…" : "Connecting…"}
              </span>
            )}
          </span>
          <Button
            variant="outline"
            className="h-12 w-12 p-0"
            aria-label={line.muted ? "Unmute" : "Mute"}
            onClick={line.toggleMute}
          >
            {line.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </Button>
          <Button
            variant="destructive"
            className="h-12 w-12 p-0"
            aria-label="Hang up"
            onClick={line.hangup}
          >
            <PhoneOff className="size-4" />
          </Button>
        </div>
        {/* Only once they have answered: there is nobody to hear the agent
            while it is still ringing. */}
        {lines.length > 0 && line.state === "active" && (
          adding ? (
            <>
              <SavedLineList
                lines={lines}
                onPick={(picked) => {
                  const second = e164(picked.phoneNumber);
                  if (!second || !from) return;
                  setAdding(false);
                  setSecondName(picked.label);
                  line.addCall(second, from);
                }}
              />
              <Button
                variant="ghost"
                className="h-10 w-full text-muted-foreground"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setAdding(true)}
            >
              <UserPlus data-icon="inline-start" />
              Add call
            </Button>
          )
        )}
        {/* The tone pad the dial card has (2026-09-25). A demo rung on the
            business's main line meets the same "press 1 for sales" a cold call
            does, and this row had no way to press anything — the call had to
            be hung up and rung again from the Keypad. Hidden while picking a
            line to add, which is its own list of buttons. */}
        {line.state === "active" && !adding && (
          padOpen ? (
            <TonePad line={line} onClose={() => setPadOpen(false)} />
          ) : (
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setPadOpen(true)}
            >
              <Grid3x3 data-icon="inline-start" />
              Keypad
            </Button>
          )
        )}
      </div>
    );
  }

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
          setActiveRow(rowKey);
          line.reset();
          line.dial(to!, from!);
        }}
      />
    </>
  );
}
