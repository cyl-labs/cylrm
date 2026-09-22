"use client";

import * as React from "react";
import { Merge, Mic, MicOff, PhoneCall, PhoneOff } from "lucide-react";
import { useCallLine } from "./call-line";
import { IncomingCall } from "./incoming-call";
import { useLineClaimed } from "./line-presence";
import { e164 } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * The call, on every screen that is not a calling screen.
 *
 * Two things live here, and both are the same idea: a call has to be visible
 * and reachable wherever its owner happens to be standing.
 *
 * **Somebody ringing in.** The dialler and the Keypad show their own banner, so
 * this one stands down while either is mounted — otherwise one call would be
 * offered twice and a caller could answer the wrong one. Everywhere else in the
 * Call CRM (Callbacks, Meetings, the Spreadsheet, Stats) nothing else would
 * show it, and a prospect ringing back would reach nobody.
 *
 * **A call already in progress.** New, and the reason the line moved into the
 * layout: a call now survives a page change, so somebody can be mid-call on a
 * screen with no phone on it. Without a bar there is no timer, no mute and — the
 * one that matters — no way to hang up short of navigating back.
 *
 * The line itself is not held here any more. `CallLineProvider` owns it, which
 * is what stops a navigation tearing the call down; this only renders it.
 */
export function InboundListener({
  savedLines = [],
  dialFrom = null,
}: {
  /** The numbers worth a button mid-call — the voice agent, chiefly. Passed
   *  from the layout so conferencing works from any screen, not only the
   *  three that render a dial card. */
  savedLines?: { phoneNumber: string; label: string }[];
  /** The caller's own number, which a second leg has to be dialled from. */
  dialFrom?: string | null;
} = {}) {
  const { line, live } = useCallLine();
  // A calling screen is showing its own call UI. Not about registration any
  // more — there is one line now — purely about who draws it.
  const claimed = useLineClaimed();

  if (!live || claimed) return null;

  const onCall = line.state !== "idle";

  return (
    <>
      {line.incoming && (
        // Fixed rather than in the flow: this can arrive over any screen in the
        // workspace, most of which know nothing about calls and have no place
        // to put a banner.
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3">
          <div className="pointer-events-auto w-full max-w-md">
            <IncomingCall key={line.incoming.from} incoming={line.incoming} />
          </div>
        </div>
      )}

      {onCall && !line.incoming && (
        <OngoingCallBar line={line} savedLines={savedLines} dialFrom={dialFrom} />
      )}
    </>
  );
}

/** The minimum a person needs while talking on a screen that is not the
 *  dialler: how long they have been on, mute, and hang up. Deliberately not a
 *  copy of the dial card — the card is where a call is *worked*, and this is
 *  what is left when you have walked away from it. */
function OngoingCallBar({
  line,
  savedLines,
  dialFrom,
}: {
  line: ReturnType<typeof useCallLine>["line"];
  savedLines: { phoneNumber: string; label: string }[];
  dialFrom: string | null;
}) {
  const mins = Math.floor(line.seconds / 60);
  const secs = String(line.seconds % 60).padStart(2, "0");

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border bg-card px-4 py-2.5 shadow-lg">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <span className="text-[13px] font-semibold">
          {line.state === "connecting" ? "Connecting…" : "On a call"}
        </span>
        <span className="text-[13px] font-bold tabular-nums text-muted-foreground">
          {mins}:{secs}
        </span>
        {/* The agent, from wherever you happen to be standing.
            Conferencing used to live only on the dial card, the Keypad and
            the Meetings row, so walking to any other screen mid-call — the
            briefing, Callbacks, Stats — left you able to talk and hang up but
            not to merge. The call survives the navigation by design; the one
            control the call is *for* did not go with it.
            Only while there is a second leg and it is not already merged:
            with nothing to join this is a button that does nothing. */}
        {line.second ? (
          !line.merged && (
            <button
              type="button"
              onClick={line.merge}
              disabled={line.merging}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <Merge className="size-3.5" strokeWidth={2.4} />
              {line.merging ? "Merging…" : "Merge"}
            </button>
          )
        ) : (
          // Nothing dialled yet, so offer the lines worth a button — the same
          // set the dial card offers, which in practice is the voice agent.
          // Only with a number to dial them from: a second leg needs the
          // caller's own DID, and without it this would fail on the press.
          dialFrom &&
          savedLines.slice(0, 2).map((l) => (
            <button
              key={l.phoneNumber}
              type="button"
              onClick={() => line.addCall(e164(l.phoneNumber) ?? l.phoneNumber, dialFrom)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors hover:bg-muted"
            >
              <PhoneCall className="size-3.5" strokeWidth={2.4} />
              {l.label}
            </button>
          ))
        )}
        <button
          type="button"
          onClick={line.toggleMute}
          aria-label={line.muted ? "Unmute" : "Mute"}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-full border transition-colors",
            line.muted ? "bg-muted" : "hover:bg-muted",
          )}
        >
          {line.muted ? (
            <MicOff className="size-4" strokeWidth={2.2} />
          ) : (
            <Mic className="size-4" strokeWidth={2.2} />
          )}
        </button>
        <button
          type="button"
          onClick={line.hangup}
          aria-label="Hang up"
          className="inline-flex size-8 items-center justify-center rounded-full bg-destructive text-primary-foreground transition-colors hover:bg-destructive/80"
        >
          <PhoneOff className="size-4" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
