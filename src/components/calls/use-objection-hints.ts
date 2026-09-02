"use client";

import * as React from "react";
import type { SopSection } from "@/lib/sop";
import {
  startLiveTranscript,
  type LiveTranscript,
  type Utterance,
} from "./live-transcript";

/**
 * Watch a live call and suggest which script fits.
 *
 * Owned by `Dialler` alongside the line, never by a component that remounts:
 * `DialControls` is keyed on whether a call is up and `CallForm` is keyed per
 * lead, so either would tear the session down mid-call.
 */

/** Suppress a label that already fired within this window. Measured across 47
 *  real calls: repetition, not error, is the dominant noise source — prospects
 *  say the same thing three ways in fifteen seconds, each is *correctly*
 *  classified, and the caller gets the same card three times. 30s removes 27%
 *  of all suggestions and the curve is flat past it. Per objection, never
 *  global: two different objections ten seconds apart are a prospect stacking
 *  reasons and the caller wants both. */
const COOLDOWN_MS = 30_000;

/** How much conversation the classifier is given as context. */
const HISTORY = 6;

export type Suggestion = { heard: string; matches: SopSection[] };

export type ObjectionHints = {
  /** Non-null while there is something to show. */
  suggestion: Suggestion | null;
  /** True once the caller has said this is a real person. */
  armed: boolean;
  /** True when there is a live call to arm. */
  available: boolean;
  arm: () => void;
  dismiss: () => void;
};

export function useObjectionHints(opts: {
  enabled: boolean;
  callActive: boolean;
  remoteStream: () => MediaStream | null;
}): ObjectionHints {
  const { enabled, callActive, remoteStream } = opts;
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null);
  const [armed, setArmed] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  const liveRef = React.useRef<LiveTranscript | null>(null);
  const historyRef = React.useRef<Utterance[]>([]);
  const lastShownRef = React.useRef<Map<string, number>>(new Map());
  // Utterances land seconds apart and the classifier can answer out of order,
  // so a slow response to an older utterance must not overwrite a newer hint.
  const seqRef = React.useRef(0);
  const latestRef = React.useRef(0);

  const classify = React.useCallback(async (text: string) => {
    const seq = ++seqRef.current;
    const history = historyRef.current.slice(-HISTORY);
    let res: Response;
    try {
      res = await fetch("/api/objection-hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance: text, history, seq }),
      });
    } catch {
      return; // Offline or aborted. No hint, no noise.
    }
    if (!res.ok) return;
    const data = (await res.json().catch(() => null)) as
      | { seq?: number; matches?: SopSection[]; heard?: string }
      | null;
    if (!data?.matches?.length) return;
    // Stale: a newer utterance has already been sent or shown.
    if ((data.seq ?? 0) < latestRef.current) return;
    latestRef.current = data.seq ?? seq;

    // Keyed on the title, which is stable and unique across both documents —
    // an index would not be, now that the labels span objections and script.
    const top = data.matches[0].title;
    const now = Date.now();
    const last = lastShownRef.current.get(top);
    if (last !== undefined && now - last < COOLDOWN_MS) return;
    lastShownRef.current.set(top, now);

    setSuggestion({ heard: data.heard ?? text, matches: data.matches });
  }, []);

  // Start capturing as soon as the call is up — but `startLiveTranscript` sends
  // nothing until armed, so this costs no money and opens no socket. The point
  // is the ring buffer: "not interested" lands in the first few seconds, and
  // waiting for the button to start capturing would miss it.
  React.useEffect(() => {
    if (!enabled || !callActive) return;
    let cancelled = false;
    const stream = remoteStream();
    if (!stream) return;
    // Captured for the cleanup below: the ref itself is stable, but reading
    // `.current` in cleanup is the pattern the lint (rightly) distrusts.
    const shown = lastShownRef.current;

    (async () => {
      try {
        const caller = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          for (const t of caller.getTracks()) t.stop();
          return;
        }
        const live = await startLiveTranscript({
          prospect: stream,
          caller,
          onUtterance: (u) => {
            historyRef.current = [...historyRef.current, u].slice(-20);
            if (u.speaker === "prospect") void classify(u.text);
          },
        });
        if (cancelled) return live.stop();
        liveRef.current = live;
        setReady(true);
      } catch {
        // Capture is best effort. A dialler that still dials is the priority.
      }
    })();

    return () => {
      cancelled = true;
      liveRef.current?.stop();
      liveRef.current = null;
      setReady(false);
      setArmed(false);
      setSuggestion(null);
      historyRef.current = [];
      shown.clear();
      latestRef.current = 0;
    };
  }, [enabled, callActive, remoteStream, classify]);

  return {
    suggestion,
    armed,
    available: enabled && callActive && ready,
    arm: React.useCallback(() => {
      liveRef.current?.arm();
      setArmed(true);
    }, []),
    dismiss: React.useCallback(() => setSuggestion(null), []),
  };
}
