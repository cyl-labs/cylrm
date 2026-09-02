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

/** How many stay on screen. Three is about a phone's worth without pushing the
 *  outcome buttons off; older ones fall off the bottom rather than expiring on
 *  a timer, so nothing vanishes while it is being read. */
const KEEP = 3;

export type ObjectionHints = {
  /** Newest first. Empty when nothing has matched yet. */
  suggestions: Suggestion[];
  /** True once the caller has said this is a real person. */
  armed: boolean;
  /** True when there is a live call to arm. */
  available: boolean;
  /**
   * The last thing the prospect was heard to say, matched or not.
   *
   * Shown while listening, and it is the answer to "is this thing working?".
   * Without it, arming changes nothing on screen until a match happens — which
   * can be a minute or never — and a caller reasonably concludes it is broken.
   * It also puts the transcription quality in front of them, so a run of
   * garbled lines explains a run of poor suggestions.
   */
  lastHeard: string | null;
  /**
   * Why it is not listening, or null.
   *
   * Silent degradation is right for a hint that does not match; it is wrong for
   * a session that never opened. The first version failed silently either way,
   * so a wrong API endpoint left "Listening" on screen for a whole call with no
   * way to tell it was dead — which is exactly how this bug reached production.
   */
  problem: string | null;
  arm: () => void;
  /** Stop listening for the rest of this call. */
  stop: () => void;
  /** Remove one card, identified by what was heard. */
  dismiss: (heard: string) => void;
};

export function useObjectionHints(opts: {
  enabled: boolean;
  callActive: boolean;
  remoteStream: () => MediaStream | null;
}): ObjectionHints {
  const { enabled, callActive, remoteStream } = opts;
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [armed, setArmed] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [lastHeard, setLastHeard] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

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

    // Bound before the closure below, which otherwise loses the narrowing.
    const matches = data.matches;
    // Keyed on the title rather than a list index: the title is stable across
    // an edit to the objection sheet, an index is not.
    const top = matches[0].title;
    const now = Date.now();
    const last = lastShownRef.current.get(top);
    if (last !== undefined && now - last < COOLDOWN_MS) return;
    lastShownRef.current.set(top, now);

    // Newest on top, older ones pushed down rather than replaced: a caller
    // glancing back wants to see the objection before last, and a card that
    // silently swapped underneath them read as "stuck on the same tip".
    setSuggestions((prev) =>
      [
        { heard: data.heard ?? text, matches },
        // Same objection raised again moves to the top rather than appearing
        // twice: two identical cards with different quotes read as a stutter,
        // and the answer to both is the same paragraph.
        ...prev.filter((p) => p.matches[0]?.title !== top),
      ].slice(0, KEEP),
    );
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
          onEnd: (reason) => {
            // Only worth saying while armed: a teardown on hangup is not a
            // fault, and the strip is gone by then anyway.
            setProblem(reason.startsWith("Stopped") || reason.includes("listening") ? reason : null);
          },
          onUtterance: (u) => {
            historyRef.current = [...historyRef.current, u].slice(-20);
            if (u.speaker !== "prospect") return;
            setLastHeard(u.text);
            void classify(u.text);
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
      setSuggestions([]);
      setLastHeard(null);
      setProblem(null);
      historyRef.current = [];
      shown.clear();
      latestRef.current = 0;
    };
  }, [enabled, callActive, remoteStream, classify]);

  return {
    suggestions,
    armed,
    available: enabled && callActive && ready,
    lastHeard,
    problem,
    arm: React.useCallback(() => {
      setProblem(null);
      liveRef.current?.arm();
      setArmed(true);
    }, []),
    stop: React.useCallback(() => {
      liveRef.current?.stop();
      liveRef.current = null;
      setArmed(false);
      setReady(false);
      setSuggestions([]);
      setLastHeard(null);
      setProblem(null);
    }, []),
    dismiss: React.useCallback(
      (heard: string) => setSuggestions((p) => p.filter((s) => s.heard !== heard)),
      [],
    ),
  };
}
