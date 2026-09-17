import type { CallEnd } from "./use-telnyx-call";

/**
 * What to tell a caller about a call that did not go through, or null.
 *
 * Only for calls the network ended. A call the caller hung up, one that was
 * answered, and one that rang out are all ordinary and say nothing here — the
 * outcome buttons already cover them.
 *
 * The case this was written for is the dead number. Telnyx refuses it with SIP
 * 404 in under a second, before anything rings, and the card went straight
 * back to its Call button. Omar pressed it twenty times on one Houston number
 * on 2026-09-16 and reasonably concluded the CRM was refusing him a business he
 * had rung before; the other Trash Panda number, rung minutes earlier, had
 * connected fine.
 */
export type CallFailure = {
  /** One line for the heading. */
  title: string;
  /** What to do, in the caller's terms. */
  advice: string;
  /** The outcome to log, when there is a clear one. */
  logAs: "bad_number" | "no_answer" | null;
};

/** The number does not exist or can no longer be reached. */
const DEAD_SIP = new Set([404, 410, 484, 604]);
const DEAD_CAUSES = new Set([
  "UNALLOCATED_NUMBER",
  "NO_ROUTE_DESTINATION",
  "NO_ROUTE_TRANSIT_NET",
  "INVALID_NUMBER_FORMAT",
  "NUMBER_CHANGED",
]);

/** A call the network ends this fast, before ringing, did not really start. */
const NEVER_STARTED_MS = 5_000;

export function callFailure(end: CallEnd | null): CallFailure | null {
  if (!end || end.answered || end.byUs) return null;

  if (
    (end.sipCode !== null && DEAD_SIP.has(end.sipCode)) ||
    (end.cause !== null && DEAD_CAUSES.has(end.cause))
  ) {
    return {
      title: "This number does not exist",
      advice:
        "The phone network turned the call away before it could ring, so pressing Call again will do the same. Log it as Bad number and move on.",
      logAs: "bad_number",
    };
  }
  // Busy is only believed with a code behind it: the SDK reports USER_BUSY by
  // default for any call that ends before it is answered.
  if (end.sipCode === 486 || end.sipCode === 600) {
    return {
      title: "The line was busy",
      advice:
        "Somebody is on the phone there. Log it as No answer and it will come back on another day.",
      logAs: "no_answer",
    };
  }
  if (end.sipCode === 603) {
    return {
      title: "They declined the call",
      advice: "Log it as No answer and it will come back on another day.",
      logAs: "no_answer",
    };
  }
  // It rang and then stopped: an unanswered call, which is not a failure.
  if (end.rang) return null;
  if ((end.sipCode !== null && end.sipCode >= 400) || end.lasted < NEVER_STARTED_MS) {
    const said = [end.sipCode, end.sipReason].filter(Boolean).join(" ");
    return {
      title: "The call did not go through",
      advice: `It ended before it rang${said ? ` (the network said: ${said})` : ""}. Try once more. If it fails again, log it as Bad number.`,
      logAs: null,
    };
  }
  return null;
}
