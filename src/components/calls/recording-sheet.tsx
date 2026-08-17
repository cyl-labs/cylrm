"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TranscriptTurn } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * Listen back to a call, and read it.
 *
 * Playback is a plain `<audio>` pointed at `/api/recordings/[id]`, which mints
 * a fresh Telnyx link on every request. That is why a recording opened a month
 * from now still plays: nothing here holds a URL, because the ones Telnyx
 * hands out expire ten minutes after the call.
 *
 * The transcript is fetched only when asked for. It costs money the first
 * time and nothing after, so the button disappears once there is text.
 */

function mmss(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RecordingSheet({
  recordingId,
  recordingMs,
  title,
  subtitle,
  open,
  onOpenChange,
}: {
  recordingId: string;
  recordingMs: number | null;
  title: string;
  subtitle?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [turns, setTurns] = React.useState<TranscriptTurn[] | null>(null);
  const [text, setText] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // A different call means a different transcript; without this, opening a
  // second lead shows the first one's words under the second one's audio.
  React.useEffect(() => {
    setTurns(null);
    setText(null);
  }, [recordingId]);

  async function getTranscript() {
    setLoading(true);
    const res = await fetch(`/api/recordings/${recordingId}/transcribe`, {
      method: "POST",
    }).catch(() => null);
    setLoading(false);

    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      toast.error(data?.error ?? "Could not transcribe that recording.");
      return;
    }
    const data = (await res.json()) as { text: string; turns: TranscriptTurn[] };
    setTurns(data.turns);
    setText(data.text);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription>
            {subtitle ? `${subtitle} · ` : ""}
            {recordingMs ? mmss(recordingMs / 1000) : "Recorded call"}
          </SheetDescription>
        </SheetHeader>

        <div className="border-b px-5 py-4">
          {/* No `preload`: the browser would fetch the audio for every lead the
              moment a sheet mounts, which is a Telnyx request per glance. */}
          <audio
            controls
            preload="none"
            src={`/api/recordings/${recordingId}`}
            className="w-full"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {turns === null ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                A transcript is written the first time it is asked for, then
                kept. Both sides are recorded on separate channels, so who said
                what comes from the audio itself rather than a guess.
              </p>
              <Button size="sm" onClick={getTranscript} disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                {loading ? "Transcribing…" : "Get transcript"}
              </Button>
            </div>
          ) : turns.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {text?.trim()
                ? text
                : "Nothing audible in this recording — no words were picked up."}
            </p>
          ) : (
            <ol className="space-y-2.5">
              {turns.map((turn, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-9 shrink-0 pt-1 text-[11px] tabular-nums text-muted-foreground">
                    {mmss(turn.start)}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-[11px] font-bold tracking-wide uppercase",
                        turn.speaker === "caller"
                          ? "text-primary"
                          : "text-muted-foreground",
                      )}
                    >
                      {turn.speaker === "caller" ? "You" : "Prospect"}
                    </p>
                    <p
                      className="mt-0.5 inline-block rounded-[3px] px-1.5 py-0.5 text-[13px] leading-relaxed"
                      style={{
                        background:
                          turn.speaker === "caller" ? "#FDE7E1" : "#EDEDED",
                      }}
                    >
                      {turn.text}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
