"use client";

import * as React from "react";
import { startCallAudio, type CallAudio } from "./call-audio";

/**
 * "What did they just say?" — asked, never volunteered.
 *
 * Audio is buffered from the moment a call connects, which costs nothing, and
 * leaves the browser only when the caller presses. Recognising that an
 * objection has been raised is their job; this exists to save them hunting for
 * which section covers it.
 *
 * Owned by `Dialler` alongside the line, never by a component that remounts:
 * `DialControls` is keyed on whether a call is up and `CallForm` is keyed per
 * lead, so either would tear the buffer down mid-call.
 */

export type Hint = {
  /** The family it pointed at, e.g. "Price". Null when nothing fits. */
  category: string | null;
  /** What the prospect was heard to say — the check on a wrong answer. */
  heard: string;
};

export type ObjectionHints = {
  /** The last answer, or null. */
  hint: Hint | null;
  /** A request is in flight. */
  asking: boolean;
  /** True when there is a live call with audio to ask about. */
  available: boolean;
  /** Why the last press produced nothing, or null. */
  problem: string | null;
  ask: () => void;
  dismiss: () => void;
  /** Drop everything, for moving to the next lead. */
  clear: () => void;
};

export function useObjectionHints(opts: {
  enabled: boolean;
  callActive: boolean;
  remoteStream: () => MediaStream | null;
}): ObjectionHints {
  const { enabled, callActive, remoteStream } = opts;
  const [hint, setHint] = React.useState<Hint | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const audioRef = React.useRef<CallAudio | null>(null);

  // Buffering starts with the call and sends nothing. No point waiting for the
  // press to start capturing: the window is ten seconds, so by then the
  // sentence being asked about has already gone.
  React.useEffect(() => {
    if (!enabled || !callActive) return;
    let cancelled = false;
    const stream = remoteStream();
    if (!stream) return;

    (async () => {
      try {
        const caller = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          for (const t of caller.getTracks()) t.stop();
          return;
        }
        const audio = await startCallAudio({ prospect: stream, caller });
        if (cancelled) return audio.stop();
        audioRef.current = audio;
        setReady(true);
      } catch {
        // Best effort. A dialler that still dials is the priority.
      }
    })();

    return () => {
      cancelled = true;
      audioRef.current?.stop();
      audioRef.current = null;
      setReady(false);
      setAsking(false);
      setProblem(null);
      // The answer deliberately outlives the hangup: a caller writes notes and
      // picks an outcome afterwards, which is when they want to look back at
      // it. Cleared on moving to the next lead instead.
    };
  }, [enabled, callActive, remoteStream]);

  const ask = React.useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || asking) return;
    const { caller, prospect } = audio.snapshot();
    if (!prospect) {
      setProblem("Nothing recorded yet — give it a moment.");
      return;
    }
    setAsking(true);
    setProblem(null);
    try {
      const body = new FormData();
      body.append("prospect", prospect, "prospect.wav");
      if (caller) body.append("caller", caller, "caller.wav");
      const res = await fetch("/api/objection-hint", { method: "POST", body });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setProblem(j?.error ?? "Could not check that.");
        return;
      }
      const data = (await res.json()) as Hint;
      if (!data.heard) {
        setProblem("Could not make out what they said.");
        return;
      }
      setHint(data);
      // A null category is a real answer rather than a failure — it means
      // nothing in the sheet covers this, which is often correct — but the
      // caller pressed a button and is owed a word either way.
      if (!data.category) setProblem("No section matches that one.");
    } catch {
      setProblem("Could not check that.");
    } finally {
      setAsking(false);
    }
  }, [asking]);

  const dismiss = React.useCallback(() => {
    setHint(null);
    setProblem(null);
  }, []);

  return {
    hint,
    asking,
    problem,
    available: enabled && callActive && ready,
    ask: () => void ask(),
    dismiss,
    clear: dismiss,
  };
}
