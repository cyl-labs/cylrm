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

const LISTENING = 1;
const CALLING = 2;

type Peer = { priority: number; seen: number };
type Message = { t: "hi" | "beat" | "bye"; id: string; priority: number };

const LineContext = React.createContext<{
  claimed: boolean;
  leader: boolean;
  claim: () => () => void;
}>({ claimed: false, leader: true, claim: () => () => {} });

export function LinePresence({ children }: { children: React.ReactNode }) {
  const [holders, setHolders] = React.useState(0);
  // Starts false so two tabs opened together cannot both register during the
  // moment before the first election. A single tab pays SETTLE_MS for that,
  // which is invisible next to minting a token and importing the SDK.
  const [leader, setLeader] = React.useState(false);

  const claim = React.useCallback(() => {
    setHolders((n) => n + 1);
    return () => setHolders((n) => Math.max(0, n - 1));
  }, []);

  const priority = holders > 0 ? CALLING : LISTENING;
  const priorityRef = React.useRef(priority);
  /** Set by the election below, so a priority change can be announced with
   *  this tab's real identity. Announcing it under any other — an empty id
   *  sorts before every uuid and would win every tie-break — silences the
   *  whole browser. */
  const postRef = React.useRef<((t: Message["t"]) => void) | null>(null);

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
      for (const [pid, p] of peers) {
        if (now - p.seen > STALE_MS) {
          peers.delete(pid);
          continue;
        }
        if (
          p.priority > priorityRef.current ||
          (p.priority === priorityRef.current && pid < id)
        ) {
          win = false;
        }
      }
      setLeader(win);
    };

    channel.onmessage = (e: MessageEvent<Message>) => {
      const m = e.data;
      if (!m || m.id === id) return;
      if (m.t === "bye") peers.delete(m.id);
      else {
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
      channel.close();
    };
  }, []);

  // Tell the other tabs the moment this one opens or leaves a calling screen,
  // rather than at the next beat: that is the handover, and a second of an
  // unregistered dialler is a second the caller cannot dial.
  React.useEffect(() => {
    priorityRef.current = priority;
    postRef.current?.("beat");
  }, [priority]);

  const value = React.useMemo(
    () => ({ claimed: holders > 0, leader, claim }),
    [holders, leader, claim],
  );
  return <LineContext.Provider value={value}>{children}</LineContext.Provider>;
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
