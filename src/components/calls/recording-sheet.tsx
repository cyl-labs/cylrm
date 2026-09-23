"use client";

import * as React from "react";
import { Check, Copy, Loader2 } from "lucide-react";
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
  startedAt = null,
  title,
  subtitle,
  callerLabel = "You",
  open,
  onOpenChange,
}: {
  recordingId: string;
  recordingMs: number | null;
  /** When the call started, already formatted in the reader's zone by
   *  whoever rendered the button that opens this sheet — a client component
   *  cannot format a date itself without one string on the server and
   *  another on hydration. Null when the caller has no time to offer. */
  startedAt?: string | null;
  title: string;
  subtitle?: string | null;
  /**
   * What to call the near side of the conversation.
   *
   * "You" is right on the board, where a caller is reading their own call, and
   * wrong on Stats, where an admin is reading somebody else's — so that screen
   * passes the caller's name. Defaulted rather than required so the board is
   * unchanged.
   */
  callerLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [turns, setTurns] = React.useState<TranscriptTurn[] | null>(null);
  const [text, setText] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  // Whether the "is there one already" question has been answered yet. Without
  // it the button flashes up for a moment on every open, inviting a click that
  // would have been unnecessary.
  const [loaded, setLoaded] = React.useState(false);
  const [at, setAt] = React.useState(0);
  const audioRef = React.useRef<HTMLAudioElement>(null);

  // A different call means a different transcript; without this, opening a
  // second lead shows the first one's words under the second one's audio.
  // Done during render rather than in an effect — React's own way of adjusting
  // state when a prop changes, and it avoids painting the old call's words for
  // a frame before an effect could clear them.
  const [renderedId, setRenderedId] = React.useState(recordingId);
  if (renderedId !== recordingId) {
    setRenderedId(recordingId);
    setTurns(null);
    setText(null);
    setLoaded(false);
    setAt(0);
  }

  // Fetch whatever is already stored. This is why a transcript survives a
  // refresh: it lives on the recording row, and until this existed the sheet
  // only ever knew about one it had made itself this session.
  React.useEffect(() => {
    let stale = false;

    fetch(`/api/recordings/${recordingId}/transcribe`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { text: string | null; turns: TranscriptTurn[] | null } | null) => {
        if (stale) return;
        if (data?.turns) {
          setTurns(data.turns);
          setText(data.text);
        }
        setLoaded(true);
      })
      .catch(() => !stale && setLoaded(true));

    return () => {
      stale = true;
    };
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

  /** Jump the audio to a turn and keep playing from there. The whole point of
   *  reading a transcript is finding the moment worth hearing. */
  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    // Rejected when the browser wants a gesture first, which this is — but a
    // failed play must not throw into the click handler.
    audio.play().catch(() => {});
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
            {startedAt ? ` · ${startedAt}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="border-b px-5 py-4">
          {/* No `preload`: the browser would fetch the audio for every lead the
              moment a sheet mounts, which is a Telnyx request per glance. */}
          <audio
            ref={audioRef}
            controls
            preload="none"
            src={`/api/recordings/${recordingId}`}
            className="w-full"
            // Drives which turn is lit while it plays. `timeupdate` fires about
            // four times a second, which is plenty for a highlight and cheap
            // enough not to matter.
            onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          />
          {/* Nothing about a list of words says it is also a set of buttons,
              and jumping to the moment something was said is most of why a
              transcript is worth having. Under the player rather than above
              the list, so it stays put while the words scroll. */}
          {turns !== null && turns.length > 0 && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                Tap any line below to play the call from that moment.
              </p>
              <CopyTranscript turns={turns} callerLabel={callerLabel} />
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!loaded ? (
            <p className="text-[13px] text-muted-foreground">Loading…</p>
          ) : turns === null ? (
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
              {turns.map((turn, i) => {
                // The turn being spoken: this one has started and the next has
                // not. The last turn runs to the end of the recording.
                const next = turns[i + 1];
                const playing =
                  at >= turn.start && (!next || at < next.start) && at > 0;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => seek(turn.start)}
                      aria-label={`Play from ${mmss(turn.start)}`}
                      className="flex w-full gap-3 rounded-md text-left transition-colors hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          "w-9 shrink-0 pt-1 text-[11px] tabular-nums",
                          playing
                            ? "font-bold text-primary"
                            : "text-muted-foreground",
                        )}
                      >
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
                          {turn.speaker === "caller" ? callerLabel : "Prospect"}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 inline-block rounded-[3px] px-1.5 py-0.5 text-[13px] leading-relaxed",
                            // The script's speaker tints, and their dark
                            // versions from `SopProse`. They were inline styles,
                            // which no dark theme can reach: light pink under
                            // light text in dark mode.
                            turn.speaker === "caller"
                              ? "bg-[#FDE7E1] dark:bg-[#46352d]"
                              : "bg-[#EDEDED] dark:bg-[#3a3a37]",
                            playing && "ring-2 ring-primary/40",
                          )}
                        >
                          {turn.text}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The whole transcript as plain text, on the clipboard.
 *
 * Timestamps included: the reason to take a transcript out of here is to quote
 * it somewhere — a handover, a Telnyx ticket, a note on a lead — and "at 4:12
 * he said" is the half that makes a quote checkable against the recording.
 *
 * Speakers are named the way the bubbles name them, so a pasted transcript
 * reads the same as the screen it came from rather than saying "caller" where
 * the sheet says a person's name.
 */
function CopyTranscript({
  turns,
  callerLabel,
}: {
  turns: TranscriptTurn[];
  callerLabel: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    const text = turns
      .map((t) => {
        const m = Math.floor(t.start / 60);
        const s = Math.floor(t.start % 60);
        const who = t.speaker === "caller" ? callerLabel : "Prospect";
        return `[${m}:${String(s).padStart(2, "0")}] ${who}: ${t.text}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Long enough to be seen, short enough that the button is ready again
      // before somebody wants to paste it a second time.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard is refused on an insecure origin and by some browsers
      // without a user gesture it recognises. Saying so beats a button that
      // looks like it worked.
      toast.error("Could not copy — select the text and copy it by hand.");
    }
  }

  return (
    <Button size="sm" variant="ghost" onClick={copy} className="shrink-0">
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
