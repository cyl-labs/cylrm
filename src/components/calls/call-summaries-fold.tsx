"use client";

import * as React from "react";
import { ChevronRight, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { briefLines } from "@/lib/brief-lines";

/** A call this long is worth a summary. The same five minutes the server uses
 *  (`SUMMARY_MIN_MS` in lib/call-summary, which cannot be imported here: it
 *  reaches the database). */
export const LONG_CALL_MS = 5 * 60_000;

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
  /** The recording, so a summary that has not been written yet can be asked
   *  for from here (2026-10-03). */
  recordingId?: string;
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
  // Summaries written from this row, keyed like the items, so one appears the
  // moment it is ready without waiting for the page to be loaded again.
  const [written, setWritten] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);

  // A long call with no summary yet used to leave the row blank, and the only
  // way to get one was to open the call and press a button there; closing it
  // left the row as it was. Every long call is listed now, with the button
  // here too (2026-10-03). Writing needs the words first, so the call is
  // transcribed on the way if it has not been: that is billed per minute, which
  // is why it only ever happens on a press.
  async function write(item: CallSummaryItem) {
    if (!item.recordingId) return;
    setBusy(item.key);
    try {
      const ask = () =>
        fetch(`/api/recordings/${item.recordingId}/summary`, { method: "POST" });
      let res = await ask();
      if (res.status === 409) {
        const t = await fetch(`/api/recordings/${item.recordingId}/transcribe`, {
          method: "POST",
        });
        if (!t.ok) {
          const d = await t.json().catch(() => ({}));
          toast.error(d.error ?? "Could not transcribe that call.");
          return;
        }
        res = await ask();
      }
      const data = (await res.json().catch(() => ({}))) as {
        summary?: string;
        error?: string;
      };
      if (!res.ok || !data.summary) {
        toast.error(data.error ?? "Could not write that summary.");
        return;
      }
      setWritten((w) => ({ ...w, [item.key]: data.summary as string }));
    } catch {
      toast.error("Could not write that summary: network error.");
    } finally {
      setBusy(null);
    }
  }

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
            {!(written[x.key] ?? x.text) && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">
                  No summary written yet.
                </span>
                {x.recordingId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void write(x)}
                  >
                    {busy === x.key ? "Writing…" : "Write summary"}
                  </Button>
                )}
              </div>
            )}
            <ul className="mt-1 space-y-1">
              {briefLines(written[x.key] ?? x.text).map((line, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug">
                  <span className="select-none text-muted-foreground">&bull;</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground">
          Generated from the call transcript. Check anything before
          repeating it to the prospect.
        </p>
      </div>
    </details>
  );
}
