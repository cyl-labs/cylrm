"use client";

import * as React from "react";

/**
 * Which screen, and which *tab*, is holding the phone line.
 *
 * Two SIP registrations against one credential means Telnyx forks an inbound
 * invite to both of them, so a caller would see two banners for one call and
 * could answer the wrong one — and a second registration can be refused
 * outright, which takes the phone away altogether.
 *
 * There are two ways to end up with two, and they need different answers:
 *
 * **Within a tab**, the dialler and the Keypad each register a line of their
 * own, so the app-wide inbound listener has to stand down while one of them is
 * mounted. That is the `claim` count below. It is a count rather than a flag
 * because navigating from the dialler to the Keypad mounts the second before
 * unmounting the first, and a flag would be cleared by the departing screen a
 * moment after the arriving one set it — leaving the listener down for the rest
 * of the session.
 *
 * **Across tabs**, nothing coordinated at all until 2026-09-04, and React
 * context cannot: it lives in one document. That was survivable while only the
 * dialler and the Keypad registered — two tabs meant deliberately opening the
 * dialler twice — but the app-wide listener made *every* Call CRM screen
 * register, so an ordinary second tab was a second registration. Hence the
 * election here: exactly one tab in a browser profile holds the line.
 *
 * **A tab with a calling screen open outranks one that is only listening**, so
 * opening the dialler in a new tab takes the line rather than being refused it.
 * That is the whole reason this is a priority election and not a plain lock:
 * a first-come lock would let a forgotten Callbacks tab keep the phone and
 * leave the dialler unable to dial.
 */

/** Same origin, so one channel name is one browser profile. */
const CHANNEL = "cylrm-line";
/** Frequent enough that a closed tab frees the line quickly, cheap enough to
 *  ignore: one small message a second between tabs of the same app. */
const BEAT_MS = 1000;
/** Three missed beats. A tab killed without firing `pagehide` — a crash, or a
 *  phone discarding a background page — is only detectable by silence. */
const STALE_MS = 3500;
/** Long enough for peers to answer the opening hello, short enough to vanish
 *  behind the token fetch and the SDK import that follow it. */
const SETTLE_MS = 300;

/**
 * A backgrounded tab ranks below a visible one.
 *
 * Added 2026-09-22, after a caller reported the Call back buttons "popping as
 * green" while he worked two tabs — copying a prospect's details from one to
 * log the call in the other. That is the line registering and unregistering
 * over and over, because `enabled && leader` in `call-line.tsx` gates the whole
 * SIP registration on winning this election.
 *
 * The cause is that the election was decided purely by a 1s heartbeat with a
 * 3.5s stale timeout, and **browsers throttle timers in hidden tabs** — Chrome
 * to about once a second, and to once a *minute* after five minutes hidden. So
 * a backgrounded tab stops beating, every other tab declares it dead inside
 * 3.5s and takes the line, and the flip reverses whenever a throttled beat
 * finally lands.
 *
 * Worse than a flickering button: in the window where the quiet tab has been
 * written off but still believes it leads, **both hold a registration** — the
 * exact state the docblock above says must not happen.
 *
 * Ranking hidden below visible fixes it without depending on a throttled timer
 * to fire at all: the visible tab wins on priority, deterministically. All tabs
 * hidden still elects one, so a caller who switches to another app keeps their
 * phone.
 *
 * **Two questions, not one, and visibility is a tier inside each rather than an
 * override.** A screen that can dial still outranks one that is only listening,
 * exactly as it did — that is what stops a forgotten Callbacks tab holding the
 * phone while somebody is trying to use the dialler, and what stops a live call
 * being taken away because another tab came to the front. The first attempt at
 * this demoted only tabs with `holders === 0` and therefore did nothing at all
 * on the screens where it bites: `holders > 0` means "a screen that can dial is
 * mounted", which is Meetings, Texts, Missed calls, the Keypad and the dialler
 * — most of the Call CRM. Caught by testing the handover rather than by
 * reading, and the numbers below are the fix.
 */
/**
 * On a call outranks everything, visible or not (2026-09-24). Without it a tab
 * mid-call that was put behind another CRM tab dropped to `CALLING_HIDDEN`,
 * the tab brought forward — any screen that can dial — won on
 * `CALLING_VISIBLE`, and the losing tab tore down its registration, which
 * hangs up the call in it. "sometimes when i click on other crm tabs it ends
 * the call im in": sometimes, because a tab on a screen that cannot dial ranks
 * too low to take it. Reported by `CallLineProvider` through `useReportCall`.
 */
const ON_CALL = 5;
const CALLING_VISIBLE = 4;
const CALLING_HIDDEN = 3;
const LISTENING_VISIBLE = 2;
const LISTENING_HIDDEN = 1;
/**
 * Asked to let go (2026-09-24), below everything until somebody uses this tab
 * again. What "Use the phone here" does to every other tab — see `take`.
 */
const YIELDED = 0;

type Peer = { priority: number; seen: number };
type Message = {
  t: "hi" | "beat" | "bye" | "take";
  id: string;
  priority: number;
};

/** Why this tab is not holding the phone: another tab is on a call, or simply
 *  holds it. Null while this tab is the one holding it. */
export type Elsewhere = "call" | "open" | null;

const LineContext = React.createContext<{
  claimed: boolean;
  leader: boolean;
  claim: () => () => void;
  setOnCall: (onCall: boolean) => void;
  ringDrawn: boolean;
  drawRing: () => () => void;
  elsewhere: Elsewhere;
  take: () => void;
}>({
  claimed: false,
  leader: true,
  claim: () => () => {},
  setOnCall: () => {},
  ringDrawn: false,
  drawRing: () => () => {},
  elsewhere: null,
  take: () => {},
});

export function LinePresence({ children }: { children: React.ReactNode }) {
  const [holders, setHolders] = React.useState(0);
  // Starts false so two tabs opened together cannot both register during the
  // moment before the first election. A single tab pays SETTLE_MS for that,
  // which is invisible next to minting a token and importing the SDK.
  const [leader, setLeader] = React.useState(false);
  // Starts visible, which is what the server rendered and what a tab opened by
  // hand is. Corrected in the effect below on mount: reading
  // `document.visibilityState` during render is a hydration mismatch.
  const [hidden, setHidden] = React.useState(false);
  const [onCall, setOnCall] = React.useState(false);
  // Counted, like `holders`, for the same dialler-to-Keypad navigation reason.
  const [ringDrawers, setRingDrawers] = React.useState(0);
  const [yielded, setYielded] = React.useState(false);
  // This tab took the phone on purpose. Wins a tie with an equal tab — two
  // Meetings windows side by side — until another tab takes it: without it the
  // tie went back to whichever tab id sorted first, so clicking into the other
  // window to scroll it handed the phone straight back.
  const [took, setTook] = React.useState(false);
  const [elsewhere, setElsewhere] = React.useState<Elsewhere>(null);

  const claim = React.useCallback(() => {
    setHolders((n) => n + 1);
    return () => setHolders((n) => Math.max(0, n - 1));
  }, []);
  const drawRing = React.useCallback(() => {
    setRingDrawers((n) => n + 1);
    return () => setRingDrawers((n) => Math.max(0, n - 1));
  }, []);

  React.useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const priority = yielded
    ? YIELDED
    : (onCall
        ? ON_CALL
        : holders > 0
          ? hidden
            ? CALLING_HIDDEN
            : CALLING_VISIBLE
          : hidden
            ? LISTENING_HIDDEN
            : LISTENING_VISIBLE) + (took ? 0.5 : 0);
  const priorityRef = React.useRef(priority);
  /** Set by the election below, so a priority change can be announced with
   *  this tab's real identity. Announcing it under any other — an empty id
   *  sorts before every uuid and would win every tie-break — silences the
   *  whole browser. */
  const postRef = React.useRef<((t: Message["t"]) => void) | null>(null);
  /** Same idea, so a tab that has just changed priority can stand down at once
   *  rather than waiting for its own next beat — which, on the tab that has
   *  just been hidden, is the very timer the browser has throttled. */
  const electRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    // No BroadcastChannel means no way to ask, so this tab behaves as it did
    // before any of this existed rather than refusing to register at all.
    if (typeof BroadcastChannel === "undefined") {
      // Scheduled rather than set here so this stays a subscription effect.
      const alone = setTimeout(() => setLeader(true), 0);
      return () => clearTimeout(alone);
    }

    const id = crypto.randomUUID();
    const peers = new Map<string, Peer>();
    const channel = new BroadcastChannel(CHANNEL);
    let stopped = false;

    const post = (t: Message["t"]) =>
      channel.postMessage({ t, id, priority: priorityRef.current } as Message);
    postRef.current = post;

    /**
     * Highest priority wins; ties break on the id, which is arbitrary but the
     * same arbitrary answer in every tab, so they cannot disagree about who
     * won and both stand down.
     */
    const elect = () => {
      if (stopped) return;
      const now = Date.now();
      let win = true;
      let top = -1;
      for (const [pid, p] of peers) {
        if (now - p.seen > STALE_MS) {
          peers.delete(pid);
          continue;
        }
        top = Math.max(top, p.priority);
        if (
          p.priority > priorityRef.current ||
          (p.priority === priorityRef.current && pid < id)
        ) {
          win = false;
        }
      }
      setLeader(win);
      // Said on the blocked screen, so it can tell somebody whether the other
      // tab is on a call or merely holding the phone — two different things
      // to do about it.
      setElsewhere(win ? null : top >= ON_CALL ? "call" : "open");
    };
    electRef.current = elect;

    channel.onmessage = (e: MessageEvent<Message>) => {
      const m = e.data;
      if (!m || m.id === id) return;
      if (m.t === "bye") peers.delete(m.id);
      else {
        // Another tab has asked for the phone: stand down until somebody uses
        // this one again. Losing the line tears down its registration and, with
        // it, any call state it was holding — which is also what clears a tab
        // that wrongly believes it is on a call.
        if (m.t === "take") {
          setYielded(true);
          setTook(false);
        }
        peers.set(m.id, { priority: m.priority, seen: Date.now() });
        // Answer a newcomer directly, so it learns about this tab within a
        // round trip instead of waiting out a whole beat to discover it is not
        // alone — the window in which both would otherwise register.
        if (m.t === "hi") post("beat");
      }
      elect();
    };

    post("hi");
    const settle = setTimeout(elect, SETTLE_MS);
    const beat = setInterval(() => {
      post("beat");
      elect();
    }, BEAT_MS);

    // A closing tab says so rather than being waited out, so the line moves in
    // a moment instead of three seconds. `pagehide` and not `beforeunload`:
    // the latter never fires on a backgrounded mobile tab.
    const leave = () => post("bye");
    window.addEventListener("pagehide", leave);

    return () => {
      stopped = true;
      clearTimeout(settle);
      clearInterval(beat);
      window.removeEventListener("pagehide", leave);
      leave();
      postRef.current = null;
      electRef.current = null;
      channel.close();
    };
  }, []);

  // Tell the other tabs the moment this one opens or leaves a calling screen,
  // or is hidden or shown, rather than at the next beat: that is the handover,
  // and a second of an unregistered dialler is a second the caller cannot dial.
  //
  // Elects as well as announces. Telling the others is only half of a handover
  // — a tab that has just been backgrounded has to stand down itself, and its
  // own beat is exactly the timer the browser has throttled, so waiting for
  // that is waiting up to a minute while two tabs both hold a registration.
  React.useEffect(() => {
    priorityRef.current = priority;
    postRef.current?.("beat");
    electRef.current?.();
  }, [priority]);

  // A tab that stood down rejoins at its own priority the moment somebody uses
  // it again — brought to the front, clicked into — rather than staying out of
  // the running for good.
  React.useEffect(() => {
    if (!yielded) return;
    const back = () => setYielded(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") back();
    };
    window.addEventListener("focus", back);
    window.addEventListener("pointerdown", back);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", back);
      window.removeEventListener("pointerdown", back);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [yielded]);

  /**
   * Bring the phone to this tab (2026-09-24).
   *
   * Every other tab stands down until it is used again. Built after a founder's
   * Meetings tab was refused the phone by a tab sitting on Scripts, minutes
   * after a demo was due: the only way out was to find and close the other tab.
   * A tab on a genuine call loses that call, which is why the button says so
   * when the other tab reports one.
   */
  const take = React.useCallback(() => {
    setYielded(false);
    setTook(true);
    postRef.current?.("take");
  }, []);

  const value = React.useMemo(
    () => ({
      claimed: holders > 0,
      leader,
      claim,
      setOnCall,
      ringDrawn: ringDrawers > 0,
      drawRing,
      elsewhere,
      take,
    }),
    [holders, leader, claim, ringDrawers, drawRing, elsewhere, take],
  );
  return <LineContext.Provider value={value}>{children}</LineContext.Provider>;
}

/** Why another tab has the phone, and the way to bring it here. */
export function useLineElsewhere(): { elsewhere: Elsewhere; take: () => void } {
  const { elsewhere, take } = React.useContext(LineContext);
  return { elsewhere, take };
}

/** True while a screen in *this tab* is holding its own line. */
export function useLineClaimed(): boolean {
  return React.useContext(LineContext).claimed;
}

/**
 * True when this tab is the one that may register with Telnyx.
 *
 * Every caller of `useTelnyxCall` must gate on it, or the tab that lost the
 * election registers anyway and the election bought nothing.
 */
export function useLineLeader(): boolean {
  return React.useContext(LineContext).leader;
}

/** Held by a screen that registers a line of its own, for as long as it is
 *  mounted. No-op outside the provider, which is every screen off the Call CRM. */
export function useClaimLine(active: boolean): void {
  const { claim } = React.useContext(LineContext);
  React.useEffect(() => {
    if (!active) return;
    return claim();
  }, [active, claim]);
}

/** Held true by the tab's phone while a call is up, ringing included, so the
 *  election never moves the line out from under it. See `ON_CALL`. */
export function useReportCall(onCall: boolean): void {
  const { setOnCall } = React.useContext(LineContext);
  React.useEffect(() => {
    setOnCall(onCall);
  }, [onCall, setOnCall]);
  React.useEffect(() => () => setOnCall(false), [setOnCall]);
}

/**
 * Held by a screen that draws its own incoming-call banner — the dialler and
 * the Keypad, and nothing else (2026-09-24).
 *
 * Not the same question as `useClaimLine`, and conflating them lost calls.
 * The app-wide banner in `InboundListener` used to stand down whenever the tab
 * was `claimed`, on the assumption that a claiming screen shows the call
 * itself. Meetings, Texts and Missed calls then started claiming the line for
 * the tab election — and none of them draws a ringing call. On those screens
 * a call rang (the ringtone lives in `CallLineProvider`) with no banner and
 * nothing to press, and landed in Missed calls: a prospect ringing back
 * straight after a dropped demo, 2026-09-23.
 */
export function useDrawsIncoming(active: boolean): void {
  const { drawRing } = React.useContext(LineContext);
  React.useEffect(() => {
    if (!active) return;
    return drawRing();
  }, [active, drawRing]);
}

/** True while a screen in this tab draws its own incoming-call banner. */
export function useIncomingDrawn(): boolean {
  return React.useContext(LineContext).ringDrawn;
}
