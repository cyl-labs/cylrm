"use client";

import * as React from "react";
import { bridgeCalls, type AudioBridge } from "./audio-bridge";

/**
 * One browser phone line, owned by the dialler.
 *
 * The SDK is imported inside the effect rather than at the top of the file:
 * a top-level import is evaluated by the SSR pass in Node, where the WebRTC
 * globals it reaches for do not exist. A dynamic import inside an effect is
 * compiled into a lazy chunk and only ever evaluated in the browser, and it
 * keeps a couple of hundred kilobytes out of the initial bundle.
 *
 * Everything lives in a ref rather than state so that re-rendering the dial
 * card, changing lead, or `router.refresh()` after logging an outcome cannot
 * disturb a call in progress. Only the parts a human looks at are state.
 */

export type CallState = "idle" | "connecting" | "ringing" | "active" | "ending";

type TelnyxCall = {
  id?: string;
  hangup: () => void;
  muteAudio: () => void;
  unmuteAudio: () => void;
  /** Optional in the type because it is called on whatever the SDK hands
   *  back: a version without it should cost a silent keypress, not a crash
   *  in the middle of someone's call. */
  dtmf?: (digit: string) => void;
  state?: string;
  telnyxIDs?: { telnyxSessionId?: string; telnyxCallControlId?: string };
  /** Read only by the audio bridge, which needs the far end's audio and the
   *  sender carrying ours. Both are on the SDK's public call interface. */
  remoteStream?: MediaStream | null;
  peer?: { instance?: RTCPeerConnection | null } | null;
};

/** The second call, when there is one. Null means there is one line up, or
 *  none — the ordinary case everywhere except the keypad. */
export type SecondLine = {
  state: CallState;
  /** Seconds since the second call was answered. */
  seconds: number;
};

/**
 * Which SDK state a call is in, in the four words a person needs. Unmapped
 * states — `purge`, `held` and the rest — return null and change nothing,
 * which is how the switch this replaced behaved.
 */
function phaseOf(state: string | undefined): CallState | null {
  switch (state) {
    case "new":
    case "requesting":
    case "trying":
      return "connecting";
    case "ringing":
    case "early":
      return "ringing";
    case "active":
      return "active";
    case "hangup":
    case "destroy":
      return "idle";
    default:
      return null;
  }
}

/**
 * Turn one leg's earpiece up or down.
 *
 * Volume rather than `muted`, because Chrome only pumps a remote WebRTC
 * stream through Web Audio once it is attached to a playing media element —
 * and the bridge taps exactly that stream a moment later. Turning the element
 * off to keep the first call private would take the bridge's input with it.
 */
function setEar(audioId: string, volume: number) {
  const el = document.getElementById(audioId);
  if (el instanceof HTMLAudioElement) el.volume = volume;
}

/**
 * Is this update about that call?
 *
 * Object identity first, the SDK's id second as a belt to that brace — the
 * notification usually carries the very object `newCall` returned, but the id
 * still matches after a ref has been cleared, which is exactly when a stray
 * update is most dangerous.
 */
function sameCall(
  call: TelnyxCall,
  known: TelnyxCall | null,
  knownId: string | null,
): boolean {
  if (known !== null && call === known) return true;
  return Boolean(call.id) && call.id === knownId;
}

export type TelnyxLine = {
  ready: boolean;
  /** Why there is no dial button, or null when there is one. */
  problem: string | null;
  state: CallState;
  /** Seconds since the call was answered. Zero until then. */
  seconds: number;
  muted: boolean;
  /** Telnyx's id for the last call, for the disposition to record. */
  sessionId: string | null;
  dial: (to: string, from: string) => void;
  hangup: () => void;
  toggleMute: () => void;
  /** A tone down the line, for the phone trees a business puts in front of
   *  its owner. Goes to the second call when there is one, that being the one
   *  just dialled and so the one with a switchboard in front of it. No-op when
   *  nothing is connected. */
  sendDigit: (digit: string) => void;
  /** Clears the timer and the session id, ready for the next lead. */
  reset: () => void;

  /** The second call, or null when there is only one. */
  second: SecondLine | null;
  /** True once both calls can hear each other. */
  merged: boolean;
  /** Merge has been asked for and has not happened yet — either the bridge is
   *  being built, or the second call is still ringing. */
  merging: boolean;
  /** Why the two calls could not be joined, or null. Cleared when the second
   *  call ends, since the next attempt starts from scratch. */
  mergeProblem: string | null;
  /**
   * Dial a second number alongside the call already up. The first call is put
   * on a private hold — muted in both directions — until the two are merged,
   * so a word with whoever answers is not overheard.
   *
   * Only available when the hook was given somewhere to play the second call's
   * audio; the dialler has one line and passes nothing.
   */
  addCall: (to: string, from: string) => void;
  /** Join the two calls. Safe to press while the second is still ringing: it
   *  merges the moment they answer, which is what you want when the far end
   *  starts talking as soon as it picks up. */
  merge: () => void;
  /** Hang up the second call only, leaving the first where it was. */
  hangupSecond: () => void;
};

export function useTelnyxCall(
  audioId: string,
  enabled: boolean,
  /** Where to play a second call's audio. Passing it is what makes
   *  `addCall` available. */
  secondAudioId?: string,
): TelnyxLine {
  const clientRef = React.useRef<{
    newCall: (opts: Record<string, unknown>) => TelnyxCall;
    disconnect: () => void;
  } | null>(null);
  const callRef = React.useRef<TelnyxCall | null>(null);
  const secondRef = React.useRef<TelnyxCall | null>(null);
  // The SDK's ids for the two lines, kept alongside the call objects because
  // identity alone is not enough: the object arrives before it has an id, and
  // the id outlives the moment the ref is cleared.
  const firstIdRef = React.useRef<string | null>(null);
  const secondIdRef = React.useRef<string | null>(null);
  // True from the moment a second call is asked for until it is gone. The SDK
  // can report the call's first state from inside `newCall`, before there is
  // anything to have assigned its return value to, and a notification arriving
  // in that gap must not be mistaken for the first call.
  const pendingSecondRef = React.useRef(false);
  // The second call we have just hung up ourselves. It goes on reporting for a
  // moment after `hangup()` returns, and those updates belong to no live line.
  // Acting on them is what made pressing × on the added line end the *first*
  // call in the UI while the prospect stayed connected and audible.
  const retiredRef = React.useRef<{ call: TelnyxCall | null; id: string | null }>(
    { call: null, id: null },
  );
  const bridgeRef = React.useRef<AudioBridge | null>(null);

  const [ready, setReady] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [state, setState] = React.useState<CallState>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [muted, setMuted] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [second, setSecond] = React.useState<SecondLine | null>(null);
  const [merged, setMerged] = React.useState(false);
  const [merging, setMerging] = React.useState(false);
  const [mergeProblem, setMergeProblem] = React.useState<string | null>(null);

  /**
   * Unwind the second call and everything it turned on.
   *
   * One function because there are four ways out — the caller ends it, the far
   * end does, the first call ends, or the tab closes — and every one of them
   * has to hand the first call back its microphone and its earpiece. Missing
   * that leaves someone talking to a prospect who cannot hear them.
   */
  const dropSecond = React.useCallback(() => {
    bridgeRef.current?.close();
    bridgeRef.current = null;
    pendingSecondRef.current = false;
    // Remembered before the hangup, not after: the updates it provokes are the
    // ones that must be recognised as this call's and ignored.
    if (secondRef.current || secondIdRef.current) {
      retiredRef.current = { call: secondRef.current, id: secondIdRef.current };
    }
    try {
      secondRef.current?.hangup();
    } catch {
      // Already gone: this runs on the far end's hangup too.
    }
    secondRef.current = null;
    secondIdRef.current = null;
    setSecond(null);
    setMerged(false);
    setMerging(false);
    setMergeProblem(null);
    try {
      callRef.current?.unmuteAudio();
    } catch {
      // The first call may have been what ended.
    }
    setMuted(false);
    setEar(audioId, 1);
  }, [audioId]);

  // Reachable from inside the connection effect, which must keep `[enabled]`
  // as its whole dependency list: anything else in there would tear down the
  // SIP registration mid-shift. Same pattern the keypad uses for its key
  // handler, and `useTouchDrag` for its callbacks.
  const dropSecondRef = React.useRef(dropSecond);
  React.useEffect(() => {
    dropSecondRef.current = dropSecond;
  });

  // Connect once, on mount. Never per lead: registering again for every number
  // would be a new SIP registration a few seconds apart all day.
  React.useEffect(() => {
    // A caller who dials from their own phone needs no line, so none is
    // opened: no token minted, no credential created, no SIP registration.
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/telnyx/token", { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setProblem(data.error ?? "Calling is unavailable.");
          return;
        }
        const { token } = (await res.json()) as { token: string };
        const { TelnyxRTC } = await import("@telnyx/webrtc");
        if (cancelled) return;

        const client = new TelnyxRTC({ login_token: token });
        client.on("telnyx.ready", () => !cancelled && setReady(true));
        client.on("telnyx.error", (e: unknown) => {
          // Logged as well as shown: the message on screen is the same four
          // words whatever went wrong, which is right for a caller mid-shift
          // and useless for working out what Telnyx actually objected to.
          console.error("[telnyx] client error", e);
          if (!cancelled) setProblem("Telnyx refused the connection.");
        });
        client.on("telnyx.notification", (n: { type: string; call?: TelnyxCall }) => {
          if (n.type !== "callUpdate" || !n.call) return;
          const call = n.call;
          const phase = phaseOf(call.state);

          // A line we have already hung up ourselves. Its remaining updates
          // describe nothing that is still on the phone, so they are dropped
          // before anything can be inferred from them.
          if (sameCall(call, retiredRef.current.call, retiredRef.current.id)) {
            return;
          }

          // Two calls can be up at once and both report through this one
          // handler, so each is identified positively. "Not the second" is not
          // the same as "the first": a second call reporting its own hangup is
          // neither, and treating it as the first handed the live call's
          // identity to a dead one — the screen went idle and stayed silent
          // about a prospect who was still connected.
          const isFirst = sameCall(call, callRef.current, firstIdRef.current);
          const isSecond = sameCall(call, secondRef.current, secondIdRef.current);
          // The gap `pendingSecondRef` exists for: the second call's earliest
          // updates can arrive from inside `newCall`, before its return value
          // has been assigned and before it has an id to be recognised by.
          const isNewSecond = !isFirst && !isSecond && pendingSecondRef.current;

          if (isSecond || isNewSecond) {
            if (call.id) secondIdRef.current = call.id;
            secondRef.current = call;
            if (!phase) return;
            if (phase === "idle") dropSecondRef.current();
            else setSecond((s) => (s ? { ...s, state: phase } : s));
            return;
          }

          // A brand new first call, for the same reason as `isNewSecond`:
          // `dial` has not yet had anywhere to put what `newCall` returned.
          const isNewFirst = callRef.current === null && !pendingSecondRef.current;
          // Anything else belongs to no line this hook is holding. Ignoring it
          // is the whole point: an unattributable update must never be able to
          // take over the first line, which is what ends a live call.
          if (!isFirst && !isNewFirst) return;

          callRef.current = call;
          if (call.id) firstIdRef.current = call.id;

          // telnyxIDs is empty for the first moments of a call, so it is read
          // on every update and the last non-empty value kept.
          const id = call.telnyxIDs?.telnyxSessionId;
          if (id) setSessionId(id);

          if (!phase) return;
          setState(phase);
          if (phase === "idle") {
            // The first call is the call. Whoever was conferenced in was
            // brought in to speak to this prospect, so they go too.
            dropSecondRef.current();
            callRef.current = null;
            firstIdRef.current = null;
            setMuted(false);
          }
        });
        client.connect();
        clientRef.current = client as unknown as typeof clientRef.current;
      } catch {
        if (!cancelled) setProblem("Could not start the phone line.");
      }
    })();

    return () => {
      cancelled = true;
      try {
        bridgeRef.current?.close();
        bridgeRef.current = null;
        secondRef.current?.hangup();
        callRef.current?.hangup();
        clientRef.current?.disconnect();
      } catch {
        // Unmounting during a call is already the bad case; nothing to do.
      }
    };
  }, [enabled]);

  // Tell the server whether this person is on a call, so an admin can see it
  // before restarting the app under them.
  //
  // Sent on every state change and then every 15s while the line is up, rather
  // than only on the transitions: a browser that crashes or is closed mid-call
  // sends no "I hung up", so the reader has to be able to notice the silence.
  // `PRESENCE_TTL_SECONDS` is three of these.
  //
  // Best-effort throughout — a failed heartbeat must never surface to someone
  // mid-conversation, and the worst case is a status that goes stale on its
  // own. Ringing counts as on a call: the disruptive moment starts when they
  // press dial, not when the far end picks up.
  React.useEffect(() => {
    if (!enabled) return;
    const onCall = state !== "idle";

    const beat = () => {
      fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onCall }),
        keepalive: true,
      }).catch(() => {});
    };

    beat();
    const t = setInterval(beat, 15_000);
    return () => clearInterval(t);
  }, [enabled, state]);

  // The visible timer. Counts from the moment they answer, not from dialling,
  // so it is the length of the conversation rather than of the ringing.
  React.useEffect(() => {
    if (state !== "active") return;
    setSeconds(0);
    const started = Date.now();
    const t = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [state]);

  // The second call's own timer, kept apart from the first one's: they are
  // answered minutes apart and a conference is two conversations of different
  // lengths, not one.
  React.useEffect(() => {
    if (second?.state !== "active") return;
    const started = Date.now();
    const t = setInterval(() => {
      const n = Math.floor((Date.now() - started) / 1000);
      setSecond((s) => (s ? { ...s, seconds: n } : s));
    }, 1000);
    return () => clearInterval(t);
  }, [second?.state]);

  // Build the bridge once both calls are up.
  //
  // An effect rather than something `merge()` does, because merging is nearly
  // always asked for while the second number is still ringing — you press it
  // and then the demo line answers — and the answer has to be what triggers
  // the wiring.
  React.useEffect(() => {
    if (!merging || merged) return;
    if (state !== "active" || second?.state !== "active") return;
    const first = callRef.current;
    const other = secondRef.current;
    if (!first || !other) return;

    let cancelled = false;
    (async () => {
      try {
        const bridge = await bridgeCalls(first, other);
        if (cancelled) {
          bridge.close();
          return;
        }
        bridgeRef.current = bridge;
        // The first call comes off its private hold. Its microphone is now
        // upstream of the mix, so leaving it muted would silence both legs.
        try {
          first.unmuteAudio();
        } catch {
          // Nothing to unmute if it just ended; the effect will not have
          // reached here in that case anyway.
        }
        setEar(audioId, 1);
        setMuted(false);
        setMerged(true);
      } catch {
        if (cancelled) return;
        setMerging(false);
        setMergeProblem("Could not join the two calls. Both are still up.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [merging, merged, state, second?.state, audioId]);

  const dial = React.useCallback(
    (to: string, from: string) => {
      if (!clientRef.current || !ready || callRef.current) return;
      setSessionId(null);
      setState("connecting");
      callRef.current = clientRef.current.newCall({
        destinationNumber: to,
        callerNumber: from,
        // Without a sink for the far end there is a call and no sound, which
        // presents as "it does not work" rather than as a wiring mistake.
        remoteElement: audioId,
        audio: true,
        video: false,
      });
    },
    [ready, audioId],
  );

  const addCall = React.useCallback(
    (to: string, from: string) => {
      const client = clientRef.current;
      const first = callRef.current;
      if (!client || !secondAudioId) return;
      if (!first || secondRef.current) return;

      // A private hold, done here rather than with SIP hold: the first call's
      // microphone is switched off and its earpiece turned down, so whoever is
      // being dialled can be spoken to without the prospect hearing it, and
      // the prospect's line is not renegotiated for something this brief.
      try {
        first.muteAudio();
      } catch {
        // Worst case the prospect overhears; not worth failing the dial for.
      }
      setEar(audioId, 0);
      setMuted(false);
      setMergeProblem(null);
      setSecond({ state: "connecting", seconds: 0 });

      pendingSecondRef.current = true;
      secondRef.current = client.newCall({
        destinationNumber: to,
        callerNumber: from,
        remoteElement: secondAudioId,
        audio: true,
        video: false,
      });
    },
    [audioId, secondAudioId],
  );

  const merge = React.useCallback(() => {
    if (!secondRef.current || bridgeRef.current) return;
    setMergeProblem(null);
    setMerging(true);
  }, []);

  const hangup = React.useCallback(() => {
    // Before the first call, so the bridge hands both legs their own
    // microphone back while there is still something to hand it to.
    dropSecondRef.current();
    // Nothing to hang up: say so rather than sitting in "ending" waiting for a
    // notification that no call is going to send. This is the shape the old
    // orphaning bug presented as — a screen stuck mid-hangup, or back at idle,
    // over a line that was still open.
    if (!callRef.current) {
      setState("idle");
      return;
    }
    setState("ending");
    try {
      callRef.current.hangup();
    } catch {
      setState("idle");
    }
  }, []);

  const toggleMute = React.useCallback(() => {
    const next = !muted;
    if (bridgeRef.current) {
      // Merged, so there is one microphone feeding both legs and it is the
      // bridge's, not either call's.
      bridgeRef.current.setMuted(next);
    } else {
      // Otherwise mute whichever call is being spoken on, which is the second
      // one while it exists: the first is already on its private hold.
      const call = secondRef.current ?? callRef.current;
      if (!call) return;
      if (next) call.muteAudio();
      else call.unmuteAudio();
    }
    setMuted(next);
  }, [muted]);

  const sendDigit = React.useCallback((digit: string) => {
    try {
      (secondRef.current ?? callRef.current)?.dtmf?.(digit);
    } catch {
      // A tone that does not go is a tone the caller presses again.
    }
  }, []);

  const reset = React.useCallback(() => {
    setSessionId(null);
    setSeconds(0);
  }, []);

  return {
    ready,
    problem,
    state,
    seconds,
    muted,
    sessionId,
    dial,
    hangup,
    toggleMute,
    sendDigit,
    reset,
    second,
    merged,
    merging,
    mergeProblem,
    addCall,
    merge,
    hangupSecond: dropSecond,
  };
}
