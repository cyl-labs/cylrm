"use client";

import { ChevronRight, ScrollText } from "lucide-react";
import { briefLines } from "@/lib/brief-lines";

/**
 * The written summaries of a business's long calls, folded under the briefing
 * on a Meetings row (2026-10-02).
 *
 * The briefing above it is written from the call that booked the meeting. A
 * demo that ran seventeen minutes, or a follow-up that ran twenty, had nothing
 * of its own, and nobody replays that to remember what the prospect said. One
 * entry per call over five minutes, oldest first, each with its length and who
 * it was with. Closed by default like the other folds: the summary line says
 * how many, and opening it is somebody asking to read them. The words each was
 * written from, and the audio, are in the recording sheet.
 */
export type CallSummaryItem = {
  key: string;
  /** "Cold call", "Demo call 2", "Call (Akshansh)". */
  label: string;
  durationMs: number | null;
  text: string;
};

const mmss = (ms: number | null) =>
  ms === null
    ? ""
    : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;

export function CallSummariesFold({ items }: { items: CallSummaryItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="group mt-3 rounded-lg border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] font-semibold">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <ScrollText className="size-3.5 shrink-0 text-muted-foreground" />
        Summaries of long calls
        <span className="font-normal text-muted-foreground">{items.length}</span>
      </summary>
      <div className="space-y-3 border-t px-3 py-2.5">
        {items.map((x) => (
          <div key={x.key}>
            <p className="text-[12px] font-semibold">
              {x.label}
              {x.durationMs !== null && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  {mmss(x.durationMs)}
                </span>
              )}
            </p>
            <ul className="mt-1 space-y-1">
              {briefLines(x.text).map((line, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug">
                  <span className="select-none text-muted-foreground">&bull;</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground">
          Written by a machine from the call&rsquo;s transcript, so check
          anything before you repeat it back to them.
        </p>
      </div>
    </details>
  );
}
