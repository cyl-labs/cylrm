"use client";

import * as React from "react";

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
  hangup: () => void;
  muteAudio: () => void;
  unmuteAudio: () => void;
  state?: string;
  telnyxIDs?: { telnyxSessionId?: string; telnyxCallControlId?: string };
};

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
  /** Clears the timer and the session id, ready for the next lead. */
  reset: () => void;
};

export function useTelnyxCall(audioId: string): TelnyxLine {
  const clientRef = React.useRef<{
    newCall: (opts: Record<string, unknown>) => TelnyxCall;
    disconnect: () => void;
  } | null>(null);
  const callRef = React.useRef<TelnyxCall | null>(null);

  const [ready, setReady] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [state, setState] = React.useState<CallState>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [muted, setMuted] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<string | null>(null);

  // Connect once, on mount. Never per lead: registering again for every number
  // would be a new SIP registration a few seconds apart all day.
  React.useEffect(() => {
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
        client.on("telnyx.error", () => {
          if (!cancelled) setProblem("Telnyx refused the connection.");
        });
        client.on("telnyx.notification", (n: { type: string; call?: TelnyxCall }) => {
          if (n.type !== "callUpdate" || !n.call) return;
          const call = n.call;
          callRef.current = call;

          // telnyxIDs is empty for the first moments of a call, so it is read
          // on every update and the last non-empty value kept.
          const id = call.telnyxIDs?.telnyxSessionId;
          if (id) setSessionId(id);

          switch (call.state) {
            case "new":
            case "requesting":
            case "trying":
              setState("connecting");
              break;
            case "ringing":
            case "early":
              setState("ringing");
              break;
            case "active":
              setState("active");
              break;
            case "hangup":
            case "destroy":
              setState("idle");
              callRef.current = null;
              setMuted(false);
              break;
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
        callRef.current?.hangup();
        clientRef.current?.disconnect();
      } catch {
        // Unmounting during a call is already the bad case; nothing to do.
      }
    };
  }, []);

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

  const hangup = React.useCallback(() => {
    setState("ending");
    try {
      callRef.current?.hangup();
    } catch {
      setState("idle");
    }
  }, []);

  const toggleMute = React.useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    if (muted) call.unmuteAudio();
    else call.muteAudio();
    setMuted(!muted);
  }, [muted]);

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
    reset,
  };
}
