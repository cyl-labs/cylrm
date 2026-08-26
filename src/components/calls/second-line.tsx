"use client";

import * as React from "react";
import { Merge, Mic, MicOff, PhoneCall, PhoneOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TelnyxLine } from "@/components/calls/use-telnyx-call";
import { cn } from "@/lib/utils";

/**
 * The parts of a three-way call that the Keypad and the dialler both show.
 *
 * Kept here rather than in either screen because the two must not drift: the
 * hold, the merge and what each line is called are the same idea in both
 * places, and a caller who learns it on one should not have to learn it again
 * on the other. Only the surroundings differ — the Keypad has a pad under
 * this, the dialler has a lead card around it.
 */

export type SavedLine = {
  phoneNumber: string;
  /** What it is for, in our words — "pxn junk removal". Set on Team. */
  label: string;
};

export function mmss(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * One of the calls in progress, when there are two of them.
 *
 * A number is right for one call and wrong for two: what matters then is which
 * of them is which, and whether the first can hear anything yet.
 */
export function LineRow({
  label,
  status,
  live,
  onEnd,
}: {
  label: string;
  status: string;
  /** Held lines are dimmed, because "on hold" is the thing being said. */
  live: boolean;
  onEnd?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2",
        !live && "opacity-60",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          live ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold">
        {label}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {status}
      </span>
      {onEnd && (
        <button
          type="button"
          aria-label={`Hang up ${label}`}
          onClick={onEnd}
          className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Both calls, stacked. Only rendered when there is a second one. */
export function LinePair({
  line,
  firstLabel,
  secondLabel,
}: {
  line: TelnyxLine;
  firstLabel: string;
  secondLabel: string;
}) {
  if (!line.second) return null;
  const status =
    line.second.state === "active"
      ? mmss(line.second.seconds)
      : line.second.state === "ringing"
        ? "Ringing…"
        : "Connecting…";

  return (
    <div className="space-y-1.5">
      <LineRow
        label={firstLabel}
        status={line.merged ? mmss(line.seconds) : "On hold"}
        live={line.merged}
      />
      <LineRow
        label={secondLabel}
        status={status}
        live
        onEnd={line.hangupSecond}
      />
    </div>
  );
}

/**
 * Mute, join, end — the controls for a call with two lines on it.
 *
 * Merge is pressable while the second call is still ringing: a voice agent
 * starts talking the moment it picks up, so waiting for the answer to press it
 * loses the opening. Once merged the button gives way to the timer, there
 * being nothing left to do but talk.
 */
export function MergeControls({ line }: { line: TelnyxLine }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        className="h-12 w-12 p-0"
        aria-label={line.muted ? "Unmute" : "Mute"}
        onClick={line.toggleMute}
      >
        {line.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
      </Button>
      {line.merged ? (
        <span className="flex h-12 flex-1 items-center justify-center rounded-xl border bg-muted/40 text-sm font-bold tabular-nums">
          {mmss(line.seconds)}
        </span>
      ) : (
        <Button
          className="h-12 flex-1"
          disabled={line.merging}
          onClick={line.merge}
        >
          <Merge data-icon="inline-start" />
          {line.merging ? "Merging…" : "Merge calls"}
        </Button>
      )}
      <Button
        variant="destructive"
        className="h-12 w-12 p-0"
        aria-label="Hang up both calls"
        onClick={line.hangup}
      >
        <PhoneOff className="size-4" />
      </Button>
    </div>
  );
}

/**
 * The lines worth a button: numbers on the account that carry a label and
 * belong to nobody.
 *
 * They ring on the tap, with no confirm. The number was labelled by hand and
 * the label already says everything there is to check about it — and this is
 * pressed with a prospect waiting on the other line.
 */
export function SavedLineList({
  lines,
  onPick,
}: {
  lines: SavedLine[];
  onPick: (line: SavedLine) => void;
}) {
  return (
    <div className="space-y-1.5">
      {lines.map((l) => (
        <button
          key={l.phoneNumber}
          type="button"
          onClick={() => onPick(l)}
          className="flex w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted active:bg-muted"
        >
          <PhoneCall className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {l.label}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {l.phoneNumber}
          </span>
        </button>
      ))}
    </div>
  );
}
