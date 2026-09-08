"use client";

import * as React from "react";
import { useLineLeader } from "./line-presence";
import { useTelnyxCall, type TelnyxLine } from "./use-telnyx-call";

/**
 * The phone, owned by the app layout rather than by a screen.
 *
 * This exists because a call used to die the moment somebody changed page. The
 * dialler and the Keypad each mounted their own `useTelnyxCall`, and a client
 * navigation unmounts the page — so the hook's cleanup hung the call up.
 * Inbound was unaffected, because `InboundListener` has always lived in the
 * layout, which is exactly the clue: a layout survives route changes and a page
 * does not.
 *
 * What a caller actually did with that was worse than the bug. Ringing a
 * callback meant copying the number, opening the Keypad and dialling there,
 * because the diary had no dial button — and then going back to the diary to
 * log the outcome, which dropped the call. The screens now link straight to the
 * dial card, and the line lives here, so neither half of that can happen.
 *
 * One line per browser, still. `LinePresence` elects a single tab (two SIP
 * registrations against one credential means Telnyx forks an invite to both),
 * and this consumes that election rather than replacing it.
 */

/** Where the two lines' audio is played. One pair for the whole app now: the
 *  dialler and the Keypad each had their own, which was only ever necessary
 *  because each held its own line. */
export const REMOTE_AUDIO_ID = "cylrm-remote-audio";
export const SECOND_AUDIO_ID = "cylrm-second-audio";

/**
 * What a leg is carrying, for the Keypad's own history table.
 *
 * Held here rather than in the Keypad, and that move is not tidiness: a leg is
 * filed when it *ends*, and now that a call outlives the screen it was placed
 * from, the Keypad may well be unmounted by then. Left where it was, navigating
 * away mid-call would have filed a row with a truncated duration and then never
 * filed the real one.
 *
 * The dialler sets none of this. A lead call is recorded as a `call` row by the
 * outcome the caller picks, which is a deliberate act rather than a side effect
 * of hanging up.
 */
export type LegMeta = {
  phone: string;
  label: string | null;
  did: string | null;
  addedToCall?: boolean;
};

type Leg = LegMeta & { sessionId: string | null; seconds: number };

type CallLineValue = {
  line: TelnyxLine;
  /**
   * The lead the live call belongs to, or null.
   *
   * Kept here because the call now outlives the dial card. Leaving the dialler
   * mid-call and coming back re-mounts it with no memory of which lead was
   * picked, so it would open on the top of the queue — a different prospect —
   * while the caller is still talking to the last one. Logging an outcome there
   * would file it against the wrong business, silently. The dialler reads this
   * back on mount and opens on the right card.
   */
  activeLeadId: number | null;
  /** Called by the dialler as it dials a lead. */
  setActiveLead: (leadId: number | null) => void;
  /** Whether a line exists at all: a browser dialler with a number of their
   *  own, in the tab that won the election. */
  live: boolean;
  /** Called by the Keypad as it dials, so the leg can be filed when it ends
   *  wherever the caller happens to be by then. */
  startLeg: (meta: LegMeta) => void;
  startSecondLeg: (meta: LegMeta) => void;
};

const CallLineContext = React.createContext<CallLineValue | null>(null);

/**
 * The line, for any screen that wants to dial or show a call.
 *
 * Throws when there is no provider above it. Loud is right: the alternative is
 * a dial button that silently does nothing, on the one feature where silence is
 * indistinguishable from the phone being broken.
 */
export function useCallLine(): CallLineValue {
  const ctx = React.useContext(CallLineContext);
  if (!ctx) {
    throw new Error(
      "useCallLine must be used inside <CallLineProvider> — it is mounted in the (app) layout.",
    );
  }
  return ctx;
}

export function CallLineProvider({
  enabled,
  children,
}: {
  /** They dial in the browser and have a number of their own. Computed once in
   *  the layout; without both there is nothing to register and nothing for a
   *  prospect to ring back. */
  enabled: boolean;
  children: React.ReactNode;
}) {
  // One tab per browser holds the phone. Read here rather than in each screen,
  // which is the point of moving the line up: there is one registration to
  // gate instead of three.
  const leader = useLineLeader();
  const line = useTelnyxCall(REMOTE_AUDIO_ID, enabled && leader, SECOND_AUDIO_ID);

  const [activeLeadId, setActiveLeadId] = React.useState<number | null>(null);

  const firstLeg = React.useRef<Leg | null>(null);
  const secondLeg = React.useRef<Leg | null>(null);

  // File a leg and forget it. Best effort, like the presence heartbeat: a
  // history row that fails to save is worth nothing next to interrupting
  // somebody mid-conversation, and `keepalive` is what lets the request outlive
  // a tab closed straight after the hangup.
  const flushLeg = (ref: React.RefObject<Leg | null>) => {
    const leg = ref.current;
    if (!leg) return;
    // Cleared first: every path here can run more than once — a re-render, a
    // second notification, an unmount after the state change — and this is what
    // makes all of them harmless.
    ref.current = null;
    fetch("/api/keypad-calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone: leg.phone,
        label: leg.label,
        fromDid: leg.did,
        telnyxSessionId: leg.sessionId,
        durationSeconds: leg.seconds,
        addedToCall: leg.addedToCall ?? false,
      }),
      keepalive: true,
    }).catch(() => {});
  };

  const flushRef = React.useRef(flushLeg);

  const busy = line.state !== "idle";
  const two = Boolean(line.second);

  // No dependency array on purpose: this refreshes the snapshots on every
  // render, which is what makes the refs hold the last live state of a line
  // rather than whatever it was dialled with.
  React.useEffect(() => {
    flushRef.current = flushLeg;
    if (busy && firstLeg.current) {
      firstLeg.current.sessionId = line.sessionId;
      firstLeg.current.seconds = line.seconds;
    }
    if (line.second && secondLeg.current) {
      secondLeg.current.sessionId = line.secondSessionId;
      secondLeg.current.seconds = line.second.seconds;
    }
  });

  // A line that has ended. Declared after the effect above so it runs second in
  // the same commit, reading the snapshot that one has just left alone.
  React.useEffect(() => {
    if (!busy) {
      flushRef.current(firstLeg);
      // The call is over, so it belongs to nobody: a stale id would send the
      // dialler to a lead nobody is talking to.
      setActiveLeadId(null);
    }
  }, [busy]);
  React.useEffect(() => {
    if (!two) flushRef.current(secondLeg);
  }, [two]);

  // Closing the tab or signing out takes the layout with it, and anything still
  // live is filed on the way out. Navigating between screens no longer reaches
  // here, which is the whole point.
  React.useEffect(
    () => () => {
      flushRef.current(secondLeg);
      flushRef.current(firstLeg);
    },
    [],
  );

  const value = React.useMemo<CallLineValue>(
    () => ({
      line,
      live: enabled && leader,
      activeLeadId,
      setActiveLead: setActiveLeadId,
      startLeg: (meta) => {
        firstLeg.current = { ...meta, sessionId: null, seconds: 0 };
      },
      startSecondLeg: (meta) => {
        secondLeg.current = { ...meta, addedToCall: true, sessionId: null, seconds: 0 };
      },
    }),
    [line, enabled, leader, activeLeadId],
  );

  return (
    <CallLineContext.Provider value={value}>
      {children}
      {/* The far end's audio, mounted once for the whole app. These have to
          outlive a page change for the same reason the line does. */}
      <audio id={REMOTE_AUDIO_ID} autoPlay />
      <audio id={SECOND_AUDIO_ID} autoPlay />
    </CallLineContext.Provider>
  );
}
