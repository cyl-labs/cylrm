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
  /** Which way the call is going. Present on an inbound invite, which is how
   *  one is told from the two outbound legs this hook already tracks. */
  direction?: string;
  /** Who is ringing. `options` is where the SDK puts the invite's caller id. */
  options?: { remoteCallerNumber?: string; remoteCallerName?: string };
  answer?: (params?: { remoteElement?: string }) => void;
  hangup: () => void;
  muteAudio: () => void;
  unmuteAudio: () => void;
  /** Why the call ended, as Telnyx told the SDK. Set only when the far end or
   *  the network ended it: a hangup from our side leaves the code empty and the
   *  cause at the SDK's own default. Read by `callFailure`. */
  cause?: string | null;
  causeCode?: number | null;
  sipCode?: number | null;
  sipReason?: string | null;
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

/**
 * How many times to ask Telnyx to register before giving up, and how long to
 * wait between asks.
 *
 * A freshly minted credential is not usable the instant it exists, and the
 * server's wait after creating one is a guess at how long activation takes —
 * measured at five seconds, observed to be too short. The browser presenting
 * that credential is what actually discovers it, so the retry belongs here
 * rather than as a longer sleep on the server, which would delay every mount
 * whether it needed it or not.
 *
 * Roughly nineteen seconds across four tries, which covers activation with
 * room to spare and is far less than the reload it replaces.
 */
const REGISTER_TRIES = 4;
const REGISTER_BACKOFF_MS = [2_000, 5_000, 12_000];

/**
 * How the last call ended, kept until the next dial or `reset()`.
 *
 * Exists because a call the network refuses ends in under a second and the
 * screen goes straight back to a Call button, which reads as the button doing
 * nothing. On 2026-09-16 Omar pressed Call on a dead number twenty times in
 * 48 minutes — Telnyx answered SIP 404 every time — and concluded the CRM was
 * refusing a business he had rung before. `callFailure` turns this into words.
 */
export type CallEnd = {
  /** It was answered at some point. */
  answered: boolean;
  /** It got as far as ringing. */
  rang: boolean;
  /** Our own hangup, which is never a failure. */
  byUs: boolean;
  /** Dial to end, in milliseconds. */
  lasted: number;
  sipCode: number | null;
  sipReason: string | null;
  cause: string | null;
};

/** A call arriving, before it has been answered or refused. */
export type Incoming = {
  /** The number ringing, as the invite gave it. */
  from: string;
  answer: () => void;
  reject: () => void;
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
  /** How the last call ended, or null while one is up or after `reset()`. */
  ended: CallEnd | null;
  /** The same for the second line, when there is one. Kept apart because the
   *  two legs are separate calls to Telnyx with a recording each — the Keypad
   *  writes a row per leg and would otherwise file both under one session.
   *  Cleared when a new second call is dialled, not when one ends, so it can
   *  still be read after the line has gone. */
  secondSessionId: string | null;
  dial: (to: string, from: string) => void;
  hangup: () => void;
  toggleMute: () => void;
  /** A tone down the line, for the phone trees a business puts in front of
   *  its owner. Goes to the second call when there is one, that being the one
   *  just dialled and so the one with a switchboard in front of it. No-op when
   *  nothing is connected. */
  sendDigit: (digit: string) => void;
  /** Clears the timer, the session id and how the last call ended, ready for
   *  the next lead. */
  reset: () => void;
  /**
   * The far end's audio on the first call, or null before media is flowing.
   *
   * Read-only, and read by the live transcript the same way `audio-bridge.ts`
   * reads it. Deliberately a getter rather than state: the stream appears part
   * way through a call and nothing should re-render when it does.
   */
  remoteStream: () => MediaStream | null;

  /** Somebody ringing in, or null. Answering makes it the first line, so the
   *  rest of this hook — the timer, mute, hangup, the transcript tap — works on
   *  it exactly as it does on a call we placed. */
  incoming: Incoming | null;
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
  /**
   * A call this hook is in the middle of placing.
   *
   * The mirror of `pendingSecondRef`, and it exists because an unattributed
   * update used to be adopted as the first line whenever no first line was
   * held. That is exactly the state an *incoming* call arrives in, and the
   * SDK's earliest update for one carries no `direction` at all — so a call
   * ringing in was claimed as the call the caller had dialled, one tick before
   * it announced itself as inbound. From then on it matched the line we
   * thought we were holding, the banner never fired, and only its hangup got
   * through. The phone could not ring.
   */
  const pendingFirstRef = React.useRef(false);
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
  const [secondSessionId, setSecondSessionId] = React.useState<string | null>(
    null,
  );
  const [second, setSecond] = React.useState<SecondLine | null>(null);
  const [incoming, setIncoming] = React.useState<Incoming | null>(null);
  const incomingRef = React.useRef<TelnyxCall | null>(null);
  const [merged, setMerged] = React.useState(false);
  const [merging, setMerging] = React.useState(false);
  const [mergeProblem, setMergeProblem] = React.useState<string | null>(null);
  const [ended, setEnded] = React.useState<CallEnd | null>(null);
  // What the first call has done so far, for `ended`. Refs because the
  // notification handler lives in the connection effect and must not re-run.
  const progressRef = React.useRef({
    at: 0,
    rang: false,
    answered: false,
    byUs: false,
  });

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
    pendingFirstRef.current = false;
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
    // Registration succeeded at least once. Only failures *before* that are
    // retried: `telnyx.error` also fires for trouble during a live call, and
    // tearing the client down to retry then would drop the conversation.
    let everReady = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    /**
     * The client as the watchdog below needs to see it.
     *
     * Two questions, not one. `connected` is the websocket, which is what
     * disappears when a laptop sleeps. `getIsRegistered()` is the SIP gateway,
     * and **that** is the one that decides whether a call can be delivered —
     * a socket can be up with the registration expired behind it, which looks
     * perfectly healthy from the tab and refuses every inbound call.
     */
    let live: {
      connected?: boolean;
      getIsRegistered?: () => Promise<boolean>;
    } | null = null;

    const start = async (attempt: number) => {
      try {
        const res = await fetch("/api/telnyx/token", { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // Retried on the same ladder a refused registration uses, and for
          // the same reason. A deploy restarts the app and this POST 502s for
          // the seconds it takes to come back — Caddy logged exactly that
          // during a restart, see the deploy notes in `AGENTS.md`. Asking once
          // and giving up left the phone dead for the rest of the shift.
          if (!everReady && !cancelled && attempt + 1 < REGISTER_TRIES) {
            retry = setTimeout(
              () => start(attempt + 1),
              REGISTER_BACKOFF_MS[attempt] ?? 12_000,
            );
            return;
          }
          // Logged in full, shown in four words — the rule the `telnyx.error`
          // branch below already follows. The route hands back the provider's
          // own `err.message`, which is a developer's sentence about API keys
          // and credentials; a caller between calls can do nothing with it.
          console.error("[telnyx] token request failed", res.status, data);
          if (!cancelled) setProblem("Calling is unavailable.");
          return;
        }
        const cred = (await res.json()) as {
          token?: string;
          login?: string;
          password?: string;
        };
        const { TelnyxRTC } = await import("@telnyx/webrtc");
        if (cancelled) return;

        // SIP credentials when the server sends them, the ephemeral token
        // otherwise. The difference is not cosmetic: a token authenticates a
        // session that can place calls, while a login registers a gateway, and
        // only a registered gateway can be rung. Inbound calls to a token-only
        // session are answered SIP 480 by the registrar.
        const client = new TelnyxRTC(
          cred.login && cred.password
            ? { login: cred.login, password: cred.password }
            : { login_token: cred.token ?? "" },
        );
        client.on("telnyx.ready", () => {
          everReady = true;
          // Which room this browser actually registered in. A tab left open
          // across a connection change keeps its old registration, so the call
          // rings a room nobody is in — invisible without this.
          console.log("[telnyx] registered, ready for calls");
          if (!cancelled) {
            setReady(true);
            // Cleared, not left standing. `problem` was write-once until
            // 2026-09-19: a line that failed and then came back on the retry
            // ladder above still read as broken for the life of the page, and
            // the dial card hides its Call button while it is set. So the
            // phone worked and the only screen that dials from it did not,
            // until somebody thought to reload.
            setProblem(null);
          }
        });
        // **The socket going away after a good registration.**
        //
        // This is the one failure nothing handled, and it is the expensive
        // one. `everReady` gates both retry ladders above, so once a browser
        // had registered, a dropped websocket ended the phone for the life of
        // the page: no error on screen, presence still heartbeating from the
        // CRM's own timer, and the caller with no reason to reload. Telnyx
        // then refuses every inbound call to that line in about a second,
        // which reads on Missed calls as "nobody picked up".
        //
        // Measured on prod on 2026-09-22: **123 of 190 inbound calls over
        // seven days were refused inside two seconds** — 65% — and it was not
        // spread evenly. Mico lost 71 of 78 and Gigi 19 of 19, which is what a
        // tab open for days with a dead socket looks like. A reload fixed it
        // every time, which is why the one call that got through at 19:56 came
        // straight after six refusals.
        //
        // So: come back, on the same ladder, but never while somebody is
        // mid-conversation — tearing the client down then would drop a live
        // call, which is the reason the ladders were gated on `everReady` in
        // the first place.
        const reconnect = (why: string) => {
          if (cancelled || callRef.current) return;
          console.warn(`[telnyx] line lost (${why}), registering again`);
          setReady(false);
          try {
            client.disconnect();
          } catch {
            // Already down; that is the thing being recovered from.
          }
          // Attempt 0 again: this is a fresh outage, not a continuation of
          // the one that may have happened at start-up, and it earns the full
          // ladder rather than whatever was left of an old one.
          retry = setTimeout(() => start(0), REGISTER_BACKOFF_MS[0]);
        };

        client.on("telnyx.socket.close", () => reconnect("socket closed"));
        client.on("telnyx.socket.error", () => reconnect("socket error"));
        client.on("telnyx.error", (e: unknown) => {
          // Logged as well as shown: the message on screen is the same four
          // words whatever went wrong, which is right for a caller mid-shift
          // and useless for working out what Telnyx actually objected to.
          console.error("[telnyx] client error", e);
          // A registration that never came up. Overwhelmingly this is a
          // credential Telnyx has issued but not yet finished activating —
          // the token is minted seconds before the browser presents it, and
          // the wait on the server is a guess at how long that takes. Before
          // this the client asked once, was refused, and stayed dead for the
          // rest of the session: the phone was gone until somebody thought to
          // reload, and nothing on screen suggested that would help.
          if (!everReady && !cancelled && attempt + 1 < REGISTER_TRIES) {
            try {
              client.disconnect();
            } catch {
              // Already down; that is what is being retried.
            }
            // A fresh token each time, not this one again: if the credential
            // behind it was the problem, presenting it a second time asks the
            // same question.
            retry = setTimeout(
              () => start(attempt + 1),
              REGISTER_BACKOFF_MS[attempt] ?? 12_000,
            );
            return;
          }
          if (!cancelled) setProblem("Telnyx refused the connection.");
        });
        client.on("telnyx.notification", (n: { type: string; call?: TelnyxCall }) => {
          // Every notification, not only the ones acted on. Inbound calling was
          // built without a real invite to test against, so when one fails to
          // ring there is otherwise no way to tell "the invite never arrived"
          // from "it arrived and was dropped" — and those need opposite fixes.
          // Call updates are logged narrowly; everything else in full. The
          // one that matters is `gatewayState`: a client that is merely
          // connected can place calls but cannot be *rung*, so outbound
          // working says nothing about whether inbound will. REGED is the
          // state that receives; NOREG, UNREGED and FAIL_WAIT do not.
          // Flat strings rather than an object: a collapsed `▶ Object` in the
          // console has to be clicked to be read, and this is read by whoever
          // is standing at the phone when it does not ring.
          console.log(
            `[telnyx] ${n.type}` +
              (n.type === "callUpdate"
                ? ` dir=${n.call?.direction} state=${n.call?.state} from=${n.call?.options?.remoteCallerNumber}`
                : ""),
          );
          if (n.type !== "callUpdate" || !n.call) return;
          const call = n.call;
          const phase = phaseOf(call.state);

          // A line we have already hung up ourselves. Its remaining updates
          // describe nothing that is still on the phone, so they are dropped
          // before anything can be inferred from them.
          if (sameCall(call, retiredRef.current.call, retiredRef.current.id)) {
            console.log("[telnyx] dropped: already retired");
            return;
          }
          if (call.direction === "inbound") {
            // Why the branch below is or is not taken. The ringing update was
            // being matched as a call we had placed ourselves and skipped, so
            // only the hangup got through — a banner that could never appear
            // while the phone was actually ringing.
            console.log(
              `[telnyx] inbound guard: same=${sameCall(
                call,
                callRef.current,
                firstIdRef.current,
              )} id=${call.id} callRef=${callRef.current?.id ?? "null"} firstId=${
                firstIdRef.current ?? "null"
              } retired=${retiredRef.current.id ?? "null"}`,
            );
          } else {
            console.log(`[telnyx] not inbound (dir=${call.direction})`);
          }

          // An invite from outside. Recognised before any of the outbound
          // matching below, because that logic asks "is this the first or the
          // second call we placed?" and an inbound call is neither — left to
          // fall through, a stranger ringing in would be adopted as the line
          // the caller thought they had dialled.
          if (
            call.direction === "inbound" &&
            !sameCall(call, callRef.current, firstIdRef.current)
          ) {
            console.log(
              `[telnyx] INBOUND recognised — phase=${phase}, ${
                phase === "idle" ? "clearing" : "showing the banner"
              }`,
            );
            if (phase === "idle") {
              // They gave up, or we answered elsewhere.
              if (sameCall(call, incomingRef.current, null)) {
                incomingRef.current = null;
                setIncoming(null);
              }
              return;
            }
            incomingRef.current = call;
            setIncoming({
              from:
                call.options?.remoteCallerNumber ??
                call.options?.remoteCallerName ??
                "Unknown number",
              answer: () => {
                // Already talking to somebody. Answering has to end that call
                // first, or `callRef` is overwritten and the live one is
                // orphaned — still connected, with nothing on screen able to
                // hang it up. Declining is the right move when busy, and the
                // banner says so; this is here so that pressing Answer anyway
                // does something coherent rather than something broken.
                if (callRef.current && callRef.current !== call) {
                  try {
                    callRef.current.hangup();
                  } catch {
                    // Already gone.
                  }
                }
                try {
                  // Where to play them. A call we dial is told this in
                  // `newCall`; an invite arrives with nothing, and the SDK
                  // attaches the far end's audio to no element at all — so
                  // whoever answered heard silence while being heard perfectly.
                  // Found on 2026-09-15, Founders ringing Omar's browser: both
                  // channels of the recording carry a voice, and Omar heard
                  // neither Founders nor the agent merged in after.
                  call.answer?.({ remoteElement: audioId });
                } catch {
                  // Gone already; the update that follows clears the banner.
                }
                // From here it is simply the first line, so the timer, mute,
                // hangup and the transcript tap all work on it unchanged.
                progressRef.current = {
                  at: Date.now(),
                  rang: true,
                  answered: false,
                  byUs: false,
                };
                setEnded(null);
                callRef.current = call;
                firstIdRef.current = call.id ?? null;
                incomingRef.current = null;
                setIncoming(null);
              },
              reject: () => {
                try {
                  call.hangup();
                } catch {
                  // Already gone.
                }
                incomingRef.current = null;
                setIncoming(null);
              },
            });
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
            // Read on every update and the last non-empty value kept, for the
            // reason the first line's is: telnyxIDs is empty for the first
            // moments of a call.
            const sid = call.telnyxIDs?.telnyxSessionId;
            if (sid) setSecondSessionId(sid);
            if (!phase) return;
            if (phase === "idle") dropSecondRef.current();
            else setSecond((s) => (s ? { ...s, state: phase } : s));
            return;
          }

          // A brand new first call, for the same reason as `isNewSecond`:
          // `dial` has not yet had anywhere to put what `newCall` returned.
          // Gated on actually having dialled, because "no first call is held"
          // is equally true of a call ringing in, and an inbound call's first
          // update carries no direction to tell them apart by.
          const isNewFirst =
            callRef.current === null &&
            pendingFirstRef.current &&
            !pendingSecondRef.current;
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
          if (phase === "ringing") progressRef.current.rang = true;
          if (phase === "active") progressRef.current.answered = true;
          if (phase === "idle") {
            // Read now: the SDK fills these in from the far end's hangup
            // before it announces the state, and nothing keeps them after.
            const p = progressRef.current;
            setEnded({
              answered: p.answered,
              rang: p.rang,
              byUs: p.byUs,
              lasted: p.at ? Date.now() - p.at : 0,
              sipCode: call.sipCode ?? null,
              sipReason: call.sipReason ?? null,
              cause: call.cause ?? null,
            });
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
        live = client as unknown as { connected?: boolean };
      } catch {
        if (!cancelled) setProblem("Could not start the phone line.");
      }
    };
    start(0);

    /**
     * Check every minute that the line is still there.
     *
     * The close and error handlers above cover a socket that announces it is
     * going. A laptop that slept through lunch, a wifi change, a VPN — those
     * come back with a socket that is quietly dead and no event ever fired.
     * The caller sees a normal-looking screen; Telnyx refuses their calls in a
     * second each.
     *
     * A minute is cheap — it is a boolean on an object — and it bounds the
     * worst case to a minute of missed calls instead of a shift of them.
     * Nothing happens while a retry is already pending or a call is up, so it
     * cannot fight the ladder or hang up on anybody.
     */
    const recheck = async (why: string) => {
      if (cancelled || retry || callRef.current || !live) return;
      let down = live.connected === false;
      if (!down && live.getIsRegistered) {
        // The socket is up; ask whether the gateway behind it still is.
        // Treated as fine if it throws, since an unanswerable question is not
        // evidence of a dead line and re-registering on a guess would drop a
        // working one.
        try {
          down = (await live.getIsRegistered()) === false;
        } catch {
          down = false;
        }
      }
      // Re-checked after the await: a call can have started while it ran.
      if (down && !cancelled && !retry && !callRef.current) {
        console.warn(`[telnyx] line is down (${why}), registering again`);
        setReady(false);
        retry = setTimeout(() => start(0), 0);
      }
    };

    const watchdog = setInterval(() => void recheck("watchdog"), 60_000);

    // The two moments a dead line is most likely, and least likely to have
    // said so: coming back online, and coming back to the tab.
    const onOnline = () => void recheck("back online");
    const onVisible = () => void recheck("tab focused");
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(watchdog);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (retry) clearTimeout(retry);
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
    // `audioId` is read by the answer handler and is a constant the provider
    // passes; listing it would add nothing and invite the teardown above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setEnded(null);
      progressRef.current = {
        at: Date.now(),
        rang: false,
        answered: false,
        byUs: false,
      };
      setState("connecting");
      // Set before `newCall`, which can emit its first updates from inside the
      // call, before there is anywhere to have put its return value.
      pendingFirstRef.current = true;
      callRef.current = clientRef.current.newCall({
        destinationNumber: to,
        callerNumber: from,
        // Without a sink for the far end there is a call and no sound, which
        // presents as "it does not work" rather than as a wiring mistake.
        remoteElement: audioId,
        audio: true,
        video: false,
      });
      pendingFirstRef.current = false;
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
      setSecondSessionId(null);
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
    // Ours, so however it ends it is not the network refusing the call.
    progressRef.current.byUs = true;
    setState("ending");
    try {
      callRef.current.hangup();
    } catch {
      // The call is gone as far as anyone can act on it, so the line lets go
      // of it too. Keeping it here left `dial` returning early on every later
      // press — a Call button that silently does nothing until a reload.
      callRef.current = null;
      firstIdRef.current = null;
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
    setEnded(null);
  }, []);

  const remoteStream = React.useCallback(
    () => callRef.current?.remoteStream ?? null,
    [],
  );

  return {
    ready,
    problem,
    state,
    seconds,
    muted,
    sessionId,
    ended,
    secondSessionId,
    dial,
    hangup,
    toggleMute,
    sendDigit,
    reset,
    remoteStream,
    incoming,
    second,
    merged,
    merging,
    mergeProblem,
    addCall,
    merge,
    hangupSecond: dropSecond,
  };
}
