"use client";

import * as React from "react";
import { useLineLeader, useReportCall } from "./line-presence";
import {
  primeRingtone,
  showIncomingNotification,
  startRingtone,
} from "./ringer";
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

/**
 * How long a finished call's session id is still offered to whoever logs it.
 *
 * Generous on purpose: the outcome is typed after hanging up, sometimes after
 * wandering off to the callbacks diary, and the case this exists for was
 * logged 37 minutes late. The memory is replaced by the next dial, so the
 * window is the *second* guard rather than the only one — it is here to stop a
 * session from this morning being attached to something typed this afternoon
 * on a tab nobody reloaded.
 */
const SESSION_MEMORY_MS = 2 * 60 * 60_000;

/**
 * Where that memory is kept so a reload does not take it.
 *
 * It was a ref and nothing else until 2026-09-20, which meant the one thing
 * guaranteed to lose it was the one thing callers do constantly: loading a
 * page. Hang up, wander to the diary or let the card refresh, log the outcome
 * — and it saved with no session, so the recording of a real conversation
 * belonged to nobody. Thirty-six in a fortnight, including the call that
 * booked a demo.
 *
 * `sessionStorage`, not `localStorage`: per tab and gone when the tab closes,
 * which is the life of a shift and the same scope the line itself has. The
 * two-hour window above still applies on read, so nothing here can attach
 * this morning's call to this afternoon's outcome.
 */
const MEMORY_KEY = "cylrm-last-call";

type Finished = {
  leadId: number;
  sessionId: string;
  seconds: number;
  at: number;
};

/** Both wrapped: storage throws in a private window and on a browser with
 *  site data switched off, and a dialler that cannot save a note to itself
 *  must still be able to place a call. */
function rememberFinished(f: Finished) {
  try {
    sessionStorage.setItem(MEMORY_KEY, JSON.stringify(f));
  } catch {
    // The ref still holds it for this page's life, which is what it did
    // before this existed.
  }
}

function recallFinished(): Finished | null {
  try {
    const raw = sessionStorage.getItem(MEMORY_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as Partial<Finished>;
    if (
      typeof f?.leadId !== "number" ||
      typeof f?.sessionId !== "string" ||
      typeof f?.at !== "number"
    ) {
      return null;
    }
    return {
      leadId: f.leadId,
      sessionId: f.sessionId,
      seconds: typeof f.seconds === "number" ? f.seconds : 0,
      at: f.at,
    };
  } catch {
    return null;
  }
}
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
  /** Placed from a Missed calls or Texts row to a number with no lead, which
   *  has no dial card to log an outcome on and would otherwise be filed
   *  nowhere — recording and all. */
  ringBack?: boolean;
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
  /**
   * Which *row* dialled, where `activeLeadId` is which lead.
   *
   * Two different questions. A prospect who booked twice has one lead and two
   * rows, and a booking that matched no lead has a row and no lead at all — so
   * the Meetings row cannot work out from the lead whether the call is its
   * own. It held that in local state until 2026-09-22, which a navigation
   * threw away: walk to another screen mid-call and back, and the row had
   * forgotten the call was its, so it fell through to a disabled "On a call"
   * button with no way left to merge the agent in. It lives here because the
   * provider is the one thing that survives a page change.
   *
   * A string rather than an id, because the rows that dial are not all
   * meetings — Missed calls dials from the same button — and two tables'
   * ids would collide.
   */
  activeRowKey: string | null;
  /**
   * The lead the *last* call was to, live or just finished.
   *
   * Kept after the call ends, where `activeLeadId` is cleared, because the
   * outcome is logged after hanging up and may be logged somewhere else
   * entirely — the callbacks diary can now be reached mid-call without dropping
   * anything, so that is exactly what people do. Without this the diary posts
   * an outcome with no session id, Telnyx's recording joins to nothing, and the
   * call has no "Listen back" and no transcript for ever. Cleared only when the
   * next call is dialled.
   */
  lastLeadId: number | null;
  /**
   * The session id of the call just made to this lead, if it is still the last
   * one the line carried.
   *
   * `line.sessionId` is live state and goes the moment the call ends, so an
   * outcome logged even a minute later posted no session and the recording
   * joined to nothing — a real call with no "Listen back" for ever. It is not a
   * rare path: a demo booked on 11 September was logged 37 minutes after the
   * call, and 28 calls in a fortnight went the same way.
   *
   * Safe to fall back to because it is keyed on the lead AND replaced by the
   * next dial: logging lead A after ringing lead B asks for A, gets B's id in
   * the record, and is refused. The window is belt and braces on top of that.
   */
  sessionFor: (leadId: number) => { sessionId: string; seconds: number } | null;
  /** Called by the dialler as it dials a lead. */
  setActiveLead: (leadId: number | null) => void;
  /** Claimed by the booking row that dialled, so it can find its own call
   *  again after a navigation. Cleared with the call. */
  setActiveRow: (key: string | null) => void;
  /**
   * Forget the call this tab placed to a lead.
   *
   * Called once an outcome has been logged. Two things hang off the memory —
   * the session id a save attaches, and whether the dial card lets you skip
   * past a lead you rang — and both should stop applying the moment the call
   * is written down. Without it, coming back to an already-logged lead through
   * a `?lead=` link would refuse to let you leave it again.
   */
  forgetLead: (leadId: number) => void;
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
  // While anything is up — a call, a second leg, or one ringing in — this tab
  // keeps the line whatever else is brought to the front. Losing the election
  // tears down the registration, and that hangs up the call.
  //
  // Only the tab actually holding the line may say so (2026-09-24). A tab that
  // is not live has no call, whatever its state says: that state can be left
  // over from a line torn down mid-call, and "on a call" outranks everything,
  // so a leftover one held the phone in a tab sitting on Scripts and refused it
  // to the founder's Meetings tab at the start of a demo.
  useReportCall(
    enabled &&
      leader &&
      (line.state !== "idle" || line.second !== null || line.incoming !== null),
  );

  // Unlock the ringtone on the first real interaction, whatever it was.
  // Browsers refuse to start audio for a page nobody has touched, and the
  // moment a call arrives is far too late to ask — the refusal is silent and
  // the phone rings where nobody can hear it. Once, then the listener removes
  // itself. `pointerdown` and `keydown` because either counts as a gesture and
  // one of them has always happened by the time a callback lands.
  React.useEffect(() => {
    const unlock = () => primeRingtone();
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", unlock, opts);
    window.addEventListener("keydown", unlock, opts);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const [activeLeadId, setActiveLeadId] = React.useState<number | null>(null);
  const [activeRowKey, setActiveRowKey] = React.useState<string | null>(null);
  const [lastLeadId, setLastLeadId] = React.useState<number | null>(null);

  const firstLeg = React.useRef<Leg | null>(null);
  const secondLeg = React.useRef<Leg | null>(null);

  /**
   * The last lead call this line carried, kept after it ends.
   *
   * A ref rather than state: nothing renders from it, and a setState on every
   * frame of a live call to record the same session id would be a re-render
   * per second of every screen under the provider.
   */
  const finished = React.useRef<{
    leadId: number;
    sessionId: string;
    seconds: number;
    at: number;
  } | null>(null);

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
        ringBack: leg.ringBack ?? false,
      }),
      keepalive: true,
    }).catch(() => {});
  };

  const flushRef = React.useRef(flushLeg);

  const busy = line.state !== "idle";
  const two = Boolean(line.second);

  // Ring out loud, and put up a notification when the CRM is not the window in
  // front, for as long as somebody is ringing in. The banner alone was silent:
  // a caller reading their notes in another tab let two calls ring out on
  // 2026-09-15 without ever knowing, for 35 and 61 seconds. Only in the tab that
  // holds the line, which is the only one that can answer.
  const ringingFrom = enabled && leader ? (line.incoming?.from ?? null) : null;
  React.useEffect(() => {
    if (!ringingFrom) return;
    // No ringtone into somebody's ear mid-conversation: the banner already says
    // a second call is waiting, and a ringing earpiece talks over the prospect.
    const stopTone = busy ? () => {} : startRingtone();
    const stopNote = showIncomingNotification(ringingFrom);
    return () => {
      stopTone();
      stopNote();
    };
    // `busy` is read once, when the ringing starts: hanging up mid-ring should
    // not suddenly start the tone for a call that has already been ringing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringingFrom]);

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
    // Remembered while the call is up, so it survives the hook clearing its
    // own state on hangup. Stamped with the time it was last seen live, which
    // is what the staleness window below is measured from.
    if (activeLeadId !== null && line.sessionId) {
      finished.current = {
        leadId: activeLeadId,
        sessionId: line.sessionId,
        seconds: line.seconds,
        at: Date.now(),
      };
      // Written on every tick the call is live rather than once at the end:
      // there is no moment this component is told "that was the last frame of
      // that call", and the last one written is the one that counts.
      rememberFinished(finished.current);
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
      setActiveRowKey(null);
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
      activeRowKey,
      lastLeadId,
      sessionFor: (leadId) => {
        // The ref first, then what the tab wrote down. They agree except
        // across a reload, which is the case this exists for.
        const f = finished.current ?? recallFinished();
        if (!f || f.leadId !== leadId) return null;
        if (Date.now() - f.at > SESSION_MEMORY_MS) return null;
        return { sessionId: f.sessionId, seconds: f.seconds };
      },
      forgetLead: (leadId) => {
        if (finished.current?.leadId === leadId) finished.current = null;
        if (recallFinished()?.leadId === leadId) {
          try {
            sessionStorage.removeItem(MEMORY_KEY);
          } catch {
            // Nothing to undo: the ref above is already cleared, and a tab
            // that cannot write storage never wrote this either.
          }
        }
        setLastLeadId((id) => (id === leadId ? null : id));
      },
      setActiveRow: setActiveRowKey,
      setActiveLead: (leadId) => {
        setActiveLeadId(leadId);
        // Whose call the line is carrying, for as long as the line remembers
        // its session id — which is until the next dial, or until the dial card
        // resets it after logging there.
        if (leadId !== null) setLastLeadId(leadId);
      },
      startLeg: (meta) => {
        firstLeg.current = { ...meta, sessionId: null, seconds: 0 };
      },
      startSecondLeg: (meta) => {
        secondLeg.current = { ...meta, addedToCall: true, sessionId: null, seconds: 0 };
      },
    }),
    [line, enabled, leader, activeLeadId, activeRowKey, lastLeadId],
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
