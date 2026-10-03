"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Copy,
  ExternalLink,
  FileSignature,
  FileText,
  Globe,
  Handshake,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PhoneCall,
  PhoneForwarded,
  PhoneOutgoing,
  ShieldAlert,
  Undo2,
  UserX,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { Meeting, MeetingFollowupResult } from "@/lib/meetings";
import type { CallOutcome } from "@/lib/calls";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import type { SmsStatus, Texting } from "@/lib/sms";
import { classifyPhone, dialableNumber, spokenNumber } from "@/lib/phone";
import { prospectZone, theirClock } from "@/lib/call-time";
import { calBookingHref, calRescheduleHref } from "@/lib/cal-link";
import { websiteHref, websiteLabel } from "@/lib/website";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmSend } from "@/components/confirm-send";
import { useClaimLine } from "@/components/calls/line-presence";
import { cn } from "@/lib/utils";
import { LogRecording } from "@/components/calls/log-recording";
import { PrepareContracts } from "@/components/calls/prepare-contracts";
import { MeetingCallButton } from "@/components/calls/meeting-call-button";
import { MoveQuietly } from "@/components/calls/move-quietly";
import type { SavedLine } from "@/components/calls/second-line";
import { TextMedia, bubbleText } from "@/components/calls/text-media";
import { MeetingBriefFold } from "@/components/calls/meeting-brief-fold";
import { DemoReviewFold } from "@/components/calls/demo-review-fold";
import type { StoredReview } from "@/lib/demo-review-types";
import {
  CallSummariesFold,
  LONG_CALL_MS,
} from "@/components/calls/call-summaries-fold";
import {
  CallBackPrompt,
  type CallBackMode,
} from "@/components/calls/founder-calls";
import type { StoredBrief } from "@/lib/brief-lines";
import { briefLines } from "@/lib/brief-lines";

/**
 * How the ring back after a missed demo ended.
 *
 * The four stored values are unchanged — they were written for a confirmation
 * call that no longer happens — so this is only the words on the menu. Ask the
 * reason, then rebook: "Rebooked" is the answer this call is trying to reach,
 * which is why it is first.
 */
const RING_BACK_LABELS: Record<MeetingFollowupResult, string> = {
  rescheduled: "Rebooked, new time agreed",
  no_answer: "No answer, try again",
  confirmed: "Spoke to them, rebooking later",
  cancelled: "Not rebooking",
};

/**
 * The answer given on Payroll, as the meeting row says it.
 *
 * "Invalid" is not a gentler no-show — it says the booking was never a real
 * question (a duplicate, a test, one logged against the wrong lead) — so it
 * reads as neither kept nor missed.
 */
/** The three answers, taken off the Meeting type rather than imported from
 *  `lib/payroll` — that module loads the Postgres client, and this is a client
 *  component. The same wall `components/calls/outcome.ts` exists for. */
type DemoStatus = NonNullable<Meeting["attendance"]>;

const ATTENDANCE_LABEL = {
  showed_up: "They showed up",
  no_show: "No show",
  invalid: "Not a real booking",
  half_fee: "Half fee (paid case by case)",
} as const;


/** What a logged ring back reads as afterwards. Shorter than the menu labels,
 *  which are written as the answer to "how did the call go". */
const FOLLOWUP_DONE: Record<MeetingFollowupResult, string> = {
  confirmed: "Spoke to them",
  no_answer: "No answer",
  rescheduled: "Rebooked",
  cancelled: "Not rebooking",
};

/** How an outbound text is doing, as the thread says it. */
const TEXT_STATUS: Record<SmsStatus, string> = {
  queued: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Didn't go through",
  received: "",
};

/**
 * How long after a text the screen keeps checking for a reply.
 *
 * The reply to "I'll call you again now" is worth seeing within seconds, and
 * nothing redraws this page when one arrives. Half an hour, because after that
 * the moment has passed, and a later reply still arrives as a notification.
 */
const AWAIT_REPLY_MS = 30 * 60_000;
const REPLY_POLL_MS = 15_000;

/**
 * What the text says before anybody edits it.
 *
 * Written as the person sending it, because it is one: no brand prefix, no
 * footer, and no company name, which the founders asked for on 2026-09-15
 * ("nobody cares"). No "Founders" either, unlike the account it sends from —
 * that name is exactly the word that would give the text away as a system,
 * so it signs as the person instead.
 *
 * Two drafts, not one, keyed on `needsRingBack` the same way the call button
 * above it is (`label`/`note`): this box is reached from a no-show's ring
 * back and from a demo that happened and is now getting the agreement links
 * (the buttons below append those into whatever is already typed), and
 * those are different messages to different people. Split 2026-09-23 after
 * one draft covered both and read wrong for whichever case it wasn't
 * written for.
 */
function textDraft(m: Meeting): string {
  const first = m.attendeeName?.trim().split(/\s+/)[0];
  const greeting = first ? `Hey ${first}` : "Hey";
  return m.needsRingBack
    ? `${greeting}, just tried calling you for your demo. I'll call you again now.`
    : `${greeting}, it's Mark sending over the docs right now, let me know if you have any questions.`;
}

/**
 * How far off it is, in words.
 *
 * Same shape as the callbacks diary's, and the same reason for it: the list is
 * read in a hurry and "in 3h" is what gets acted on. Days are the unit that
 * matters here rather than minutes, since the rule is about tomorrow.
 */
/**
 * A clock that ticks, so a card left open notices time passing.
 *
 * The same reason `LocalTime` on the dial card ticks rather than being baked
 * into the page: this list sits open across a demo starting, and a screen that
 * is believed and stale is worse than one that admits it does not know.
 *
 * Null until mounted, and everything falls back to the server's own answer
 * until then — a first client render that disagreed with the HTML would be a
 * hydration mismatch, and here it would be one that adds or removes a button.
 */
function useNow(intervalMs = 30_000) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );
  return React.useSyncExternalStore(
    subscribe,
    // Quantised to the interval so repeated reads between ticks return the
    // identical number: a snapshot that changed on every call is an infinite
    // render loop, which is the trap this hook exists inside.
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    // The server has no clock to offer, and saying so is what keeps the first
    // client render identical to the HTML.
    () => null,
  );
}

/**
 * Hide recordings under 30 seconds on the meeting rows (2026-09-28, a minute
 * until 2026-10-01, when a 45 second demo call was being hidden): voicemails,
 * rings nobody answered and calls that dropped straight away, which sat on a
 * row as "Follow-up call 3 0:18" beside the one conversation worth hearing.
 * On by default, remembered per browser, and switched off in one tap for the
 * day somebody needs to prove a voicemail was left.
 */
const SHORT_CALL_MS = 30_000;
const HIDE_SHORT_KEY = "cylrm-hide-short-calls";
const HIDE_SHORT_EVENT = "cylrm-hide-short-calls";

function readHideShort(): boolean {
  try {
    return localStorage.getItem(HIDE_SHORT_KEY) !== "0";
  } catch {
    return true;
  }
}

function useHideShortCalls(): [boolean, (v: boolean) => void] {
  const hide = React.useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(HIDE_SHORT_EVENT, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(HIDE_SHORT_EVENT, onChange);
      };
    },
    readHideShort,
    // The default on the server, so the HTML matches a browser that never
    // changed it.
    () => true,
  );
  const set = React.useCallback((v: boolean) => {
    try {
      localStorage.setItem(HIDE_SHORT_KEY, v ? "1" : "0");
    } catch {}
    window.dispatchEvent(new Event(HIDE_SHORT_EVENT));
  }, []);
  return [hide, set];
}

/** A recording with no length is kept: not knowing is not the same as short. */
const isShort = (ms: number | null) => ms !== null && ms < SHORT_CALL_MS;

function when(iso: string, now: number | null) {
  const mins = Math.round((new Date(iso).getTime() - (now ?? Date.now())) / 60000);
  if (mins <= 0) {
    const ago = Math.abs(mins);
    if (ago === 0) return "just now";
    return ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
  }
  if (mins < 60) return `in ${mins}m`;
  // Hours and minutes, not hours rounded: 12:30 and 1:00 read "in 51m" and
  // "in 1h" side by side when they are 81 minutes away (2026-10-02).
  const hm = (m: number) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r === 0 ? `${h}h` : `${h}h ${r}m`;
  };
  if (mins < 60 * 24) return `in ${hm(mins)}`;
  if (mins < 60 * 24 * 3) {
    const d = Math.floor(mins / 60 / 24);
    const h = Math.floor((mins - d * 24 * 60) / 60);
    return h === 0 ? `in ${d}d` : `in ${d}d ${h}h`;
  }
  return `in ${Math.round(mins / 60 / 24)}d`;
}

/** Handed over by the founders — the intake form sent to a business once
 *  they're moving forward, alongside the contract link. */
const FORM_URL = "https://forms.gle/P2K4aMFL4vUJhCWr7";

/** Appends onto whatever is already drafted rather than replacing it, since
 *  the contract and form links are both dropped into the same text one after
 *  the other. */
function appendLink(body: string, url: string): string {
  const trimmed = body.trimEnd();
  return trimmed ? `${trimmed}\n${url}` : url;
}

/**
 * What a follow-up call can come to.
 *
 * Not every outcome: this is a conversation with somebody who has already sat
 * through a demo, so "gatekeeper" and "bad number" say nothing, and a fresh
 * "demo booked" would ask payroll to pay the attendance fee twice. Call back
 * is left out too — it needs a time, and the dial card is where that box
 * lives.
 */
const FOLLOW_UP_OUTCOMES: CallOutcome[] = [
  "following_up",
  "no_answer",
  "trial",
  "won",
  "lost",
];

/** The outcomes a row names as where the sale stands. Anything earlier is
 *  what the meeting itself already says. */
const SALE_STAGES = new Set<string>(["following_up", "trial", "won", "lost"]);

export function MeetingsList({
  meetings,
  canDial = false,
  tz,
  zoneLabel,
  showWho = false,
  bookingUrl = null,
  followUpBookingUrl = null,
  signingBase = "",
  past = false,
  texting = null,
  lines = [],
  canInvite = false,
  briefs = null,
  reviews = null,
  bookingReviews = null,
  bookedByMe = null,
  closerId = null,
  closers = [],
}: {
  meetings: Meeting[];
  /** The screen's clock, chosen on the server. Passed rather than read from
   *  the browser: `toLocaleString(undefined, …)` renders one string on the
   *  droplet's UTC and another on a Singapore laptop, and React throws the
   *  tree away on every load. */
  tz: string;
  zoneLabel: string;
  /** Who booked it. Admins only, like the callbacks diary — a caller's own
   *  diary has their name on every row, which is noise. */
  showWho?: boolean;
  /** `CAL_BOOKING_URL`, the demo event type. Only the reschedule link is built
   *  from it here — nothing on this screen books a new demo — so null means no
   *  Reschedule button on a demo row. */
  bookingUrl?: string | null;
  /** `CAL_FOLLOWUP_URL`, the second Cal.com event type. Null means no button,
   *  the rule every unconfigured feature here follows. */
  followUpBookingUrl?: string | null;
  /** DocuSeal's public host. Empty when it is not configured, which is what
   *  hides the contract buttons rather than offering ones that cannot work. */
  signingBase?: string;
  /** The full history rather than the rolling queue — only changes the empty
   *  state's wording, which otherwise tells somebody with no past meetings
   *  that Cal.com bookings "appear here within a few minutes," a sentence
   *  about the wrong list. */
  past?: boolean;
  /** Texts to the prospect and their replies. Null when texting is switched
   *  off or the reader is not an admin, which draws no button and no thread. */
  texting?: Texting | null;
  /** The labelled lines a call from here can be merged with — the voice
   *  agent's demo number among them. */
  lines?: SavedLine[];
  /** Whether this reader dials from the browser at all. Decides whether this
   *  tab claims the phone: a handset caller registers no line to fight over. */
  canDial?: boolean;
  /** Whether Cal.com is connected, which is the whole of whether an invitation
   *  can be re-sent. False draws no button rather than one that can only fail
   *  — the rule every unconfigured feature on this screen follows. */
  canInvite?: boolean;
  /** Each meeting's written brief, by meeting. Null for a caller, which draws
   *  no Briefing fold: writing one costs an OpenAI call and the Briefing page
   *  and its route are founders only. */
  briefs?: Record<number, StoredBrief> | null;
  /** Demo call reviews, founders and the meeting's closer only. */
  reviews?: Record<number, StoredReview> | null;
  /** Reviews of the cold call that booked each demo: founders for all, a caller for their own. */
  bookingReviews?: Record<number, StoredReview> | null;
  /** For a caller, the meetings their own call booked (they may review only those). */
  bookedByMe?: number[] | null;
  /** The reader's own id when they are a closer, else null. A row they were
   *  handed (`closerUserId`) gets the closing controls a founder has. */
  closerId?: number | null;
  /** Who a founder can hand a meeting to. Empty for anybody else, and when
   *  nobody on the team is a closer, which draws no control at all. */
  closers?: { id: number; name: string }[];
}) {
  const router = useRouter();
  /**
   * Hold the phone for this tab while this screen is open.
   *
   * Every Call CRM tab registers at listening priority so the inbound banner
   * works anywhere; a tab with a *calling* screen outranks it, which is what
   * stops a forgotten tab keeping the line. The dial card and the Keypad have
   * always claimed it and this screen, which dials too, never did
   * (2026-09-20) — so a second tab left on Scripts could win the election and
   * this row would say "the phone is open in another CRM tab" while that tab
   * could not dial at all.
   *
   * False for a handset caller, who registers no line to fight over.
   */
  useClaimLine(canDial);

  // Ticks every half minute. Without it a card open across 1:00 AM kept the
  // server's answer to "has this started", so the badge read "just now" while
  // the button for saying what happened was still absent — the screen said
  // the demo was under way and offered no way to record it.
  const now = useNow();
  const [hideShort, setHideShort] = useHideShortCalls();
  // How many a row would lose, for the switch's label. Counted over every
  // recording a row can show, so the number matches what disappears.
  const shortCount = meetings.reduce(
    (n, m) =>
      n +
      (m.recordingId && isShort(m.recordingMs) ? 1 : 0) +
      m.earlierDemoRecordings.filter((r) => isShort(r.durationMs)).length +
      m.demoRecordings.filter((r) => isShort(r.durationMs)).length +
      m.otherRecordings.filter((r) => isShort(r.durationMs)).length,
    0,
  );
  const [busy, setBusy] = React.useState<number | null>(null);
  /**
   * A text being written. Under the row rather than in a dialog, for the reason
   * the ring-back notes are: the name and the demo time stay readable while it
   * is typed, and those are what the text is about.
   */
  const [composing, setComposing] = React.useState<{
    meetingId: number;
    body: string;
  } | null>(null);
  /** Send text pressed, waiting on the last look (`ConfirmSend`). One at a
   *  time, like the composer it belongs to. */
  const [confirmingText, setConfirmingText] = React.useState(false);

  /**
   * Keep the page fresh while a reply could be on its way.
   *
   * Only while a text went out in the last half hour, and only in a visible
   * tab, so a screen left open overnight does not poll for nothing.
   * `router.refresh()` keeps whatever is typed in an open box.
   */
  React.useEffect(() => {
    if (!texting) return;
    const since = Date.now() - AWAIT_REPLY_MS;
    const waiting = Object.values(texting.byLead).some((lead) =>
      lead.texts.some(
        (t) => t.direction === "out" && new Date(t.at).getTime() > since,
      ),
    );
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REPLY_POLL_MS);
    return () => clearInterval(timer);
  }, [texting, router]);

  async function sendText(meeting: Meeting, body: string) {
    setBusy(meeting.id);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not send the text.");
        return;
      }
      setComposing(null);
      toast.success(
        `Texted ${meeting.attendeeName ?? meeting.company ?? "them"}`,
      );
      router.refresh();
    } catch {
      // The request may have reached the server before the connection went,
      // so this must not read as "nothing happened, press it again".
      toast.error(
        "Lost the connection while sending, so it may or may not have gone. Refresh and check before sending again.",
      );
    } finally {
      setBusy(null);
    }
  }
  /**
   * The address an invitation is being re-sent to, before it is sent.
   *
   * Opened from the row, prefilled with whatever the CRM holds for the
   * business when that is not what the booking has — which is the usual shape
   * of this mistake, since the lead goes on being corrected after the booking
   * has frozen its copy.
   */
  const [inviting, setInviting] = React.useState<{
    meetingId: number;
    email: string;
  } | null>(null);

  /**
   * Send this booking's invitation to another address.
   *
   * It adds the address as a guest on Cal.com, because an attendee's email
   * cannot be changed — see the route. The toast says what actually happened
   * rather than "saved": somebody who believes the booking was corrected will
   * not think to check that the prospect got anything.
   */
  async function sendInvite(meeting: Meeting, email: string) {
    setBusy(meeting.id);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not send the invitation.");
        return;
      }
      setInviting(null);
      toast.success(
        `Invitation sent to ${email}${data.savedToLead ? ", and saved as their email" : ""}`,
      );
      router.refresh();
    } catch {
      // It may have reached Cal.com before the connection went, and a second
      // attempt on the same address is refused as a duplicate — so this must
      // not read as "nothing happened, press it again".
      toast.error(
        "Lost the connection, so the invitation may or may not have gone. Refresh and check before sending again.",
      );
    } finally {
      setBusy(null);
    }
  }

  /**
   * Picked but not yet logged.
   *
   * The ring back is where the awkward detail turns up — they want to move it,
   * the decision maker will not be there, they asked for the deck first — and
   * the result on its own carries none of it. The founder taking the demo reads
   * this row and nothing else beforehand.
   */
  const [picked, setPicked] = React.useState<{
    meetingId: number;
    result: MeetingFollowupResult;
    notes: string;
  } | null>(null);

  /**
   * Answered but not yet saved.
   *
   * Picking one of the three used to fire on the tap, which is the gesture the
   * dial card's own outcome menu was moved away from after a mis-tap became a
   * call in the record — and it left nowhere to write down what the demo turned
   * up. The ring back logger sits on this same row and already works this way,
   * so it costs a tap and buys one behaviour instead of two.
   *
   * Prefilled from what is stored, so changing an answer carries the note with
   * it rather than asking for it again.
   */
  // The "when do you call them back?" prompt, and which way in: after a
  // no-show, after a call back went unanswered or rebooking was put off, or
  // to move one. See `CallBackPrompt`.
  // The meeting being moved in the CRM only, see `MoveQuietly`.
  const [movingQuietly, setMovingQuietly] = React.useState<Meeting | null>(null);
  const [prompt, setPrompt] = React.useState<{
    m: Meeting;
    mode: CallBackMode;
    /** Opening note and time, when the prompt starts from a recording. */
    notes?: string;
    at?: string;
  } | null>(null);
  const [answering, setAnswering] = React.useState<{
    meetingId: number;
    status: DemoStatus;
    notes: string;
  } | null>(null);
  /**
   * The follow-up call after a demo, picked but not yet saved.
   *
   * Confirmed in two steps like everything else on this row: one tap next to
   * another was the whole gesture on the dial card once, and a mis-tap became
   * a call in the record that had to be found and corrected later. The notes
   * box is most of the point — what the mock-up call turned up is the thing
   * nobody could write down before.
   */
  const [following, setFollowing] = React.useState<{
    meetingId: number;
    outcome: CallOutcome;
    notes: string;
  } | null>(null);

  const format = React.useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      }),
    [tz],
  );

  /** The day the demo was agreed, in the reader's zone like every other date
   *  on this screen. Date only: the line it sits on is already carrying the
   *  start time, the prospect's clock and who booked it, and "when did we
   *  agree this" is a question a day answers. */
  const bookedFormat = React.useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        timeZone: tz,
      }),
    [tz],
  );

  /**
   * Their clock, when it is not ours. What you say the time back to them in
   * — the thing the SOP makes a caller work out by hand today.
   *
   * Both halves live in `lib/call-time.ts` so that the row, the Telegram
   * reminder and the evening digest cannot end up naming three different
   * clocks for one demo: `prospectZone` picks whose zone to believe, and
   * `theirClock` carries their weekday when their date is not ours.
   */
  const theirTime = React.useCallback(
    (iso: string, m: Meeting) =>
      theirClock(new Date(iso), prospectZone(m.leadTz, m.attendeeTz), tz),
    [tz],
  );

  /**
   * Say what happened at the meeting.
   *
   * The same record Payroll writes, keyed on the booking call, so an answer
   * given on this screen and one given there cannot disagree — and the $30
   * attendance fee is decided once, wherever somebody happened to be standing.
   * Admins only for that reason: a caller marking their own booking as having
   * shown up would be signing off their own commission.
   */
  /**
   * Log a follow-up call against the lead.
   *
   * Straight to `/api/calls`, the same route the dial card posts to, so this
   * is a call in the record like any other: it counts toward the day, moves
   * the lead on the board, and carries its notes. That is the difference from
   * the no-show ring back, which deliberately writes no call row — this one is
   * a conversation that happened, and the founders asked for it to count.
   */
  /**
   * Pick one answer from a follow-up menu (2026-10-04).
   *
   * "No answer" is not logged as a call here. A `no_answer` call is a retry
   * outcome, so it put a lead in the middle of a sale back into the callers'
   * cold queue (Toro Dumpsters: logged No answer after a follow-up, and the row
   * showed nothing happening). It is a reminder to ring them back instead: the
   * call back prompt, the same one a missed demo uses, which adds a founders'
   * call back (or counts one more try on the one already open) and shows on the
   * row.
   */
  function pickFollowUp(meeting: Meeting, outcome: CallOutcome) {
    // Founders only: the call back route is theirs, and a closer's No answer
    // still logs a call as before.
    if (outcome === "no_answer" && showWho) {
      setPrompt(
        meeting.callBack
          ? { m: meeting, mode: "no_answer" }
          : { m: meeting, mode: "new", notes: "No answer on the follow-up call." },
      );
      return;
    }
    setFollowing({ meetingId: meeting.id, outcome, notes: "" });
  }

  async function logFollowUp(
    meeting: Meeting,
    outcome: CallOutcome,
    notes: string,
  ) {
    if (meeting.leadId === null) return;
    setBusy(meeting.id);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLeadId: meeting.leadId,
          outcome,
          notes: notes.trim(),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setFollowing(null);
      toast.success(`Logged: ${OUTCOME_LABELS[outcome]}`);
      router.refresh();
    } catch {
      toast.error("Could not log that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Write off a follow-up as not a real booking, or take a whole business off
   * Meetings (2026-09-29: "delete people who are wasting our time"). Nothing
   * is deleted and nothing is sent: follow-ups are closed with a cancelled
   * ring-back row, and "everything" also logs the sale as lost through
   * `/api/calls`, which is what stops a demo row asking to be followed up.
   */
  async function drop(meeting: Meeting, everything: boolean) {
    const who = meeting.company ?? meeting.attendeeName ?? "this meeting";
    const ask = everything
      ? `Take ${who} off Meetings? This marks the sale as lost and closes every follow-up booked for them. Nothing is sent to them, and their calls and recordings are kept.`
      : `Mark this follow-up with ${who} as not a real booking? It comes off your list. Nothing is sent to them.`;
    if (!window.confirm(ask)) return;
    setBusy(meeting.id);
    try {
      if (everything && meeting.leadId !== null && meeting.leadOutcome !== "lost") {
        const lost = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callLeadId: meeting.leadId,
            outcome: "lost",
            notes: "Taken off Meetings: not worth following up.",
          }),
        });
        if (!lost.ok) throw new Error(String(lost.status));
      }
      const res = await fetch(`/api/meetings/${meeting.id}/drop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ everything }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not take that off. Try again.");
        return;
      }
      toast.success(
        everything ? `${who} is off Meetings, marked as lost` : `Not a real booking: ${who}`,
        { description: "Still under Past meetings if you need it." },
      );
      router.refresh();
    } catch {
      toast.error("Could not take that off. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** Hand a meeting to a closer, or back to the founders (null). */
  async function assignCloser(
    meeting: Meeting,
    closer: { id: number; name: string } | null,
  ) {
    if ((closer?.id ?? null) === meeting.closerUserId) return;
    setBusy(meeting.id);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/closer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closerUserId: closer?.id ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not save that.");
        return;
      }
      const who = meeting.company ?? meeting.attendeeName ?? "meeting";
      toast.success(
        closer ? `${closer.name} is closing ${who}` : `Founders are taking ${who}`,
      );
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setBusy(null);
    }
  }

  async function mark(
    meeting: Meeting,
    status: DemoStatus,
    notes: string,
  ) {
    if (meeting.leadId === null) return;
    setBusy(meeting.id);
    try {
      const res = await fetch("/api/payroll/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Always sent, even empty: the route reads a missing field as "leave
        // the note alone" and an empty one as "clear it", and this box has just
        // shown somebody the note it is about to replace.
        body: JSON.stringify({
          callId: meeting.bookingCallId,
          // Pins the answer to this meeting at its current time, which is what
          // lets it be given before the meeting starts (2026-09-25).
          meetingId: meeting.id,
          status,
          notes: notes.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not save that.");
        return;
      }
      setAnswering(null);
      toast.success(
        `${ATTENDANCE_LABEL[status]}: ${meeting.company ?? meeting.attendeeName ?? "meeting"}`,
      );
      // A business booked twice has two cards, and each is answered on its own,
      // so writing one off left its twin sitting under "not logged" (KR
      // Services, 2026-10-03). Ask once rather than assuming: the other booking
      // may be the real one.
      if (status === "invalid") {
        const twins = meetings.filter(
          (x) =>
            x.id !== meeting.id &&
            x.leadId === meeting.leadId &&
            x.kind === "demo" &&
            x.status !== "cancelled" &&
            x.attendance === null,
        );
        const who = meeting.company ?? meeting.attendeeName ?? "this business";
        if (
          twins.length > 0 &&
          window.confirm(
            `${who} has ${twins.length === 1 ? "another booking" : `${twins.length} other bookings`} that ${twins.length === 1 ? "is" : "are"} not logged yet. Mark ${twins.length === 1 ? "it" : "them"} as not a real booking too?`,
          )
        ) {
          for (const t of twins) {
            const r = await fetch("/api/payroll/attendance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                callId: t.bookingCallId,
                meetingId: t.id,
                status: "invalid",
                notes: notes.trim(),
              }),
            });
            if (!r.ok) {
              toast.error("Could not mark the other booking. Do it on its own card.");
              break;
            }
          }
        }
      }
      // A no-show is followed up by the founders, every time (2026-09-24), and
      // the decision is asked for now: a call back on their calendar, or dead.
      // A closer's no-show goes to the founders the same way a caller's does.
      if (status === "no_show" && showWho) {
        setPrompt({ m: meeting, mode: "no_show" });
      }
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * "Rebooked" and "Not rebooking" on a call back: logged at once, nothing to
   * ask. The other two ask when to ring next, through the prompt.
   */
  async function undoAnswer(meeting: Meeting) {
    setBusy(meeting.id);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/answer`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not undo that.");
        return;
      }
      toast.success(
        `Undone: ${meeting.company ?? meeting.attendeeName ?? "meeting"} is waiting for an answer again.`,
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function closeCallBack(
    meeting: Meeting,
    result: "rescheduled" | "cancelled",
  ) {
    if (!meeting.callBack) return;
    const who = meeting.company ?? meeting.attendeeName ?? "meeting";
    if (
      result === "cancelled" &&
      !window.confirm(`Not rebooking ${who}? This takes them off your list for good.`)
    ) {
      return;
    }
    setBusy(meeting.id);
    try {
      const res = await fetch(`/api/founder-calls/${meeting.callBack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not log the call back.");
        return;
      }
      toast.success(
        result === "rescheduled"
          ? `Rebooked: ${who}. Put the new time in from More, then Move.`
          : `Not rebooking: ${who} is off your list.`,
      );
      router.refresh();
    } catch {
      toast.error("Could not log the call back: network error.");
    } finally {
      setBusy(null);
    }
  }

  async function log(
    meeting: Meeting,
    result: MeetingFollowupResult,
    notes: string,
  ) {
    setBusy(meeting.id);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, notes: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not log the follow-up.");
        return;
      }
      setPicked(null);
      toast.success(
        `${FOLLOWUP_DONE[result]}: ${meeting.company ?? meeting.attendeeName ?? "meeting"}`,
      );
      router.refresh();
    } catch {
      toast.error("Could not log the follow-up: network error.");
    } finally {
      setBusy(null);
    }
  }

  if (meetings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center">
        <p className="text-sm font-semibold">
          {past ? "No past meetings." : "No meetings booked."}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {past
            ? "A meeting moves here once its time has passed."
            : "They appear here within a few minutes of being booked on Cal.com."}
        </p>
      </div>
    );
  }

  return (
    <>
    {/* Only when there is something to hide, so the switch never sits over a
        list it cannot change. */}
    {shortCount > 0 && (
      <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={hideShort}
          onChange={(e) => setHideShort(e.target.checked)}
        />
        Hide calls under 30 seconds (voicemails and dropped calls)
        <span className="tabular-nums">
          {hideShort ? `(${shortCount} hidden)` : `(${shortCount} showing)`}
        </span>
      </label>
    )}
    <ul className="flex flex-col gap-2">
      {meetings.map((m) => {
        // The recordings this row shows, short ones dropped when the switch
        // above says so, and numbered after dropping so the labels still
        // count 1, 2, 3.
        const keep = (ms: number | null) => !hideShort || !isShort(ms);
        const earlierDemo = m.earlierDemoRecordings.filter((r) => keep(r.durationMs));
        const ownRecordings = m.demoRecordings.filter((r) => keep(r.durationMs));
        const otherCalls = m.otherRecordings.filter((r) => keep(r.durationMs));
        const cancelled = m.status === "cancelled";
        // Every recording that could be the demo, for the review's picker
        // (2026-10-03): the automatic pick plus every other call to this
        // business, so a reviewer can choose the real one, or every part of one
        // that dropped. Not filtered by "hide short calls": a short part of a
        // dropped demo still has to be selectable.
        const reviewCalls = (() => {
          const seen = new Set<string>();
          const out: { recordingId: string; label: string; durationMs: number | null; startedAt: string | null }[] = [];
          const add = (
            r: { recordingId: string; durationMs: number | null; startedAt?: string | null },
            label: string,
          ) => {
            if (seen.has(r.recordingId)) return;
            seen.add(r.recordingId);
            out.push({ recordingId: r.recordingId, label, durationMs: r.durationMs, startedAt: r.startedAt ?? null });
          };
          m.demoRecordings.forEach((r, i) => add(r, i === 0 ? "Demo call" : `Demo call ${i + 1}`));
          m.earlierDemoRecordings.forEach((r) => add(r, "Earlier demo call"));
          m.otherRecordings.forEach((r) =>
            add(
              r,
              r.byName
                ? `${r.direction === "in" ? "They called" : "Call"} (${r.byName})`
                : "Other call",
            ),
          );
          return out
            .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
            .map((c) => ({
              recordingId: c.recordingId,
              label: c.label,
              durationMs: c.durationMs,
              startedLabel: c.startedAt
                ? `${format.format(new Date(c.startedAt))} ${zoneLabel}`
                : null,
            }));
        })();
        // The server's answer until the clock above has ticked once, then the
        // live one. `m.started` was worked out when the page rendered, which
        // is the wrong moment for a card somebody is still looking at when
        // the demo begins.
        const hasStarted =
          now === null ? m.started : new Date(m.startAt).getTime() <= now;
        // May this reader close it: a founder always, a closer on the
        // meetings a founder handed them (2026-09-25). Everything that closes a
        // meeting — what happened, contracts, the follow-up — hangs off this.
        const closes =
          showWho || (closerId !== null && m.closerUserId === closerId);
        // A meeting is moved on the event type it was booked on, or it comes
        // back through the sync as the other kind — a follow-up rescheduled
        // onto the demo link would be asked whether they turned up, and a
        // second attendance fee is exactly what `call_demo_attendance`'s
        // unique index exists to refuse.
        const rescheduleBase =
          m.kind === "follow_up" ? followUpBookingUrl : bookingUrl;
        const their = theirTime(m.startAt, m);
        // Where a moved meeting now is, on their clock.
        const theirCallBack = m.callBack ? theirTime(m.callBack.at, m) : null;
        // The one zone this row believes, used for the label and for both
        // Cal.com links. Kept as one value on purpose: the row said one thing
        // and the booking pages opened in another while the links read
        // `attendeeTz` directly.
        const theirZone = prospectZone(m.leadTz, m.attendeeTz);
        // The two copies of the prospect's email disagreeing. Compared
        // case-insensitively because nothing about a mailbox is case
        // sensitive in practice, and a row shouting about `Vincent@` against
        // `vincent@` would teach people to ignore it.
        const emailMismatch =
          !cancelled &&
          !!m.leadEmail &&
          !!m.attendeeEmail &&
          m.leadEmail.toLowerCase() !== m.attendeeEmail.toLowerCase();
        // This business's text conversation, when texting is on.
        const lead =
          texting && m.leadId !== null ? texting.byLead[m.leadId] : undefined;
        // US numbers only: the campaign registered with the carriers covers
        // nothing else, so a Singapore lead gets no button rather than one
        // that can only refuse.
        const textable =
          texting !== null &&
          m.leadId !== null &&
          !!m.phone &&
          !m.dncBlock &&
          classifyPhone(m.phone) === "us";
        const repliedLast =
          lead !== undefined &&
          lead.texts.length > 0 &&
          lead.texts[lead.texts.length - 1].direction === "in";
        return (
          <li
            key={m.id}
            // The calendar's chips link here — `#meeting-<id>` — since a
            // click there is "take me to the row where anything gets done"
            // rather than a second place to act from. `scroll-mt-4` keeps the
            // row's own top edge off the viewport edge when it lands.
            id={`meeting-${m.id}`}
            className={cn(
              // `:target` needs no client JS: the browser sets it just by
              // matching the URL's fragment, so the row a calendar click
              // lands on says so even before hydration.
              "scroll-mt-4 rounded-xl border bg-card p-3.5 sm:p-4 target:ring-2 target:ring-primary/50",
              // The server's answer, so the border cannot differ between the
              // HTML and the hydration. It marks what is nearly here, not work
              // owed — there is no confirmation call to owe any more.
              m.startingSoon && "border-primary/40",
              // The only row on this screen that is work owed, so it is the
              // only one that shouts.
              (m.needsRingBack || m.needsLogging) && "border-destructive/40",
              m.callBack?.due && "border-amber-500/60",
              cancelled && "opacity-70",
            )}
          >
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                {/* Wraps rather than truncating: a cut-off business name does
                    not tell you who you are about to ring. */}
                <p className="font-bold tracking-[-0.01em]">
                  {m.company ?? m.attendeeName ?? "Unlinked booking"}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[m.attendeeName, m.attendeeEmail]
                    .filter(Boolean)
                    .join(" · ") || "No contact on the booking"}
                </p>
                {/* The booking's address against the one the CRM holds, when
                    they disagree. The booking's copy is frozen the moment the
                    Cal.com link is opened and can never be edited after; the
                    lead's goes on being corrected. So a caller who mishears an
                    address, fixes the lead and moves on leaves a booking whose
                    invitation went nowhere, with nothing on the screen saying
                    so — which is exactly what happened to Grab N Junk, spotted
                    two days later by the caller rather than by this screen. */}
                {emailMismatch && (
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    The invitation went to{" "}
                    <span className="font-semibold">{m.attendeeEmail}</span>.
                    This business&apos;s email is{" "}
                    <span className="font-semibold">{m.leadEmail}</span>. If
                    the booking has it wrong, send the invitation again below.
                  </p>
                )}
                {/* Which number this row is about to ring, when it is not the
                    one on the lead. The prospect is asked for the best number
                    when they book, and it is usually a mobile where the lead
                    carries the company's switchboard — so the row says which
                    one it has, rather than quietly dialling the other.
                    Leads with the number itself, bold and in the same
                    `font-semibold` the ring confirm (`confirm-call.tsx`)
                    gives it, rather than burying it mid-sentence (2026-09-23):
                    a first pass named both numbers but gave them equal
                    weight in one run-on line, and the one actually being
                    dialled still did not stand out against the listed one
                    beside it — see Pro Junk Removal LLC. */}
                {m.listedPhone && m.phone && (
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Calls{" "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {spokenNumber(m.phone)}
                    </span>
                    , the number they gave when booking, not their listed
                    line,{" "}
                    <span className="tabular-nums">
                      {spokenNumber(m.listedPhone)}
                    </span>
                    .
                  </p>
                )}
                {/* What the business actually does, which the booking notes
                    cannot answer and a founder wants thirty seconds before
                    the call. A new tab: leaving this page would drop a live
                    line. Only rendered through `websiteHref`, which admits
                    http(s) and nothing else — this value came off a scraped
                    page, and `javascript:` in an href runs on click. */}
                {websiteHref(m.website) && (
                  <a
                    href={websiteHref(m.website)!}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-0.5 inline-flex max-w-full items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
                  >
                    <Globe className="size-3.5 shrink-0" strokeWidth={2.2} />
                    <span className="truncate">{websiteLabel(m.website)}</span>
                    <ExternalLink
                      className="size-3 shrink-0 text-muted-foreground"
                      strokeWidth={2.2}
                    />
                  </a>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {cancelled ? (
                  <Badge variant="destructive">
                    <CalendarX2 className="size-3" strokeWidth={2.4} />
                    Cancelled
                  </Badge>
                ) : m.callBack ? (
                  // Moved to a call back: the countdown is to that, since it
                  // is where the meeting now is.
                  <Badge
                    suppressHydrationWarning
                    className={cn(
                      "border-transparent",
                      m.callBack.due
                        ? "bg-amber-500 text-amber-950"
                        : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                    )}
                  >
                    <PhoneForwarded className="size-3" strokeWidth={2.4} />
                    Call back · {when(m.callBack.at, now)}
                  </Badge>
                ) : (
                  // Counts down live, so it can cross a boundary between the
                  // render and the hydration — same note as the board.
                  <Badge
                    suppressHydrationWarning
                    variant={m.startingSoon ? "default" : "secondary"}
                  >
                    {when(m.startAt, now)}
                  </Badge>
                )}
                {/* Answered on Payroll: this meeting is finished business, and
                    a row that looks like every other one reads as work still
                    owed. Said here rather than replacing the countdown, because
                    when it happened is still worth seeing. */}
                {m.attendance && (
                  <Badge
                    variant="outline"
                    className={cn(
                      m.attendance === "showed_up" &&
                        "border-success/40 text-success",
                      m.attendance === "no_show" &&
                        "border-destructive/40 text-destructive",
                    )}
                  >
                    {ATTENDANCE_LABEL[m.attendance]}
                  </Badge>
                )}
                {/* Where the sale stands, once it is past the demo
                    (2026-09-25). It read only on the board, so a follow-up
                    moved to a new time looked as if the Trial logged on the
                    old one had been lost. Not on a cancelled row, whose
                    replacement carries it. */}
                {!cancelled &&
                  m.leadOutcome &&
                  SALE_STAGES.has(m.leadOutcome) && (
                    <Badge
                      variant="outline"
                      className={cn(
                        (m.leadOutcome === "trial" || m.leadOutcome === "won") &&
                          "border-success/40 text-success",
                        m.leadOutcome === "lost" &&
                          "border-destructive/40 text-destructive",
                      )}
                    >
                      {OUTCOME_LABELS[m.leadOutcome as CallOutcome]}
                    </Badge>
                  )}
                {/* A reply is the one thing on a row that may need answering
                    within the minute, so it is said where the eye lands. */}
                {repliedLast && (
                  <Badge>
                    <MessageSquare className="size-3" strokeWidth={2.4} />
                    Texted back
                  </Badge>
                )}
                {m.listName && (
                  <Badge variant="outline" className="max-w-32">
                    <span className="min-w-0 truncate">{m.listName}</span>
                  </Badge>
                )}
              </div>
            </div>

            {/* A meeting moved to a call back (2026-09-24): its new time first,
                where the demo's used to be, and the demo it replaced under it.
                Moved only here — the booking itself, and what attendance and
                payroll read, still says when the demo was. */}
            {m.callBack && (
              <p className="mt-1.5 text-[13px]">
                <span className="font-bold text-amber-800 dark:text-amber-300">
                  Call back
                </span>{" "}
                <span className="font-semibold">
                  {format.format(new Date(m.callBack.at))}
                </span>{" "}
                <span className="text-muted-foreground">
                  {zoneLabel}
                  {theirCallBack && ` · ${theirCallBack} their time`}
                </span>
              </p>
            )}
            <p
              className={cn(
                "text-muted-foreground",
                m.callBack ? "mt-0.5 text-[12px]" : "mt-1.5 text-[13px]",
              )}
            >
              {m.callBack && "Demo was "}
              <span className="font-semibold text-foreground">
                {format.format(new Date(m.startAt))}
              </span>{" "}
              {zoneLabel}
              {/* Their clock, so the time you say back to them is the time
                  they will be sitting down at. */}
              {their && ` · ${their} their time`}
              {/* When it was agreed, and by whom — one clause rather than
                  two, because "booked by Harry on 14 Sep" is the sentence
                  somebody actually asks of a demo in the diary they do not
                  remember agreeing to. It used to be readable only by opening
                  the notes fold, which is not there at all when the booking
                  call left no notes. The date shows to everyone; only the
                  name is admin-only, as it is in the callbacks diary. */}
              {(m.bookedAt || (showWho && m.bookedBy)) && (
                <>
                  {" · booked"}
                  {showWho && m.bookedBy && (
                    <>
                      {" by "}
                      <span className="font-semibold text-foreground">
                        {m.bookedBy}
                      </span>
                    </>
                  )}
                  {m.bookedAt && (
                    <>
                      {" on "}
                      <span className="font-semibold text-foreground">
                        {bookedFormat.format(new Date(m.bookedAt))}
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
            {/* A booking Cal.com cancelled because it was rescheduled
                (2026-10-02): say so, and where it went, so someone listening
                to its recording knows why it is marked cancelled. */}
            {m.status === "cancelled" && m.rescheduledTo && (
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Rescheduled on Cal.com. The new booking is{" "}
                <span className="font-semibold text-foreground">
                  {format.format(new Date(m.rescheduledTo.startAt))} {zoneLabel}
                </span>
                .
              </p>
            )}
            {/* A cancelled row cannot make contracts, so it hands you to the
                live booking (2026-10-02: Kevin moved to Sunday, and the new
                row sat far down the list). Searching by business shows
                upcoming and past together, so the target is always on the
                page. With no booking matched, the same search still lists
                every meeting the business has. */}
            {cancelled && m.company && (
              <Link
                href={`/meetings?q=${encodeURIComponent(m.company)}${
                  m.rescheduledTo ? `#meeting-${m.rescheduledTo.id}` : ""
                }`}
                className="mt-2 inline-flex rounded-md border bg-background px-2.5 py-1 text-[12px] font-semibold hover:bg-muted"
              >
                {m.rescheduledTo
                  ? "Go to the new meeting"
                  : "Find their other meetings"}
              </Link>
            )}
            {/* Moved in the CRM only (2026-09-28). Cal.com still has the old
                time and sends its reminder for it, so the row says so. */}
            {m.calStartAt && (
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Moved quietly from{" "}
                <span className="font-semibold text-foreground">
                  {format.format(new Date(m.calStartAt))} {zoneLabel}
                </span>
                . Cal.com still has that time, so its reminder email goes out
                for it. This meeting also stays under Past meetings.
              </p>
            )}

            {/* A follow-up already on the calendar (2026-09-25). Without it a
                demo row looked like one still to arrange, with "Book a
                follow-up" sitting there, and it was easy to think it had been
                forgotten. */}
            {m.nextFollowUpAt && (
              <p className="mt-1.5 inline-flex flex-wrap items-center gap-x-1.5 rounded-md bg-success/10 px-2.5 py-1 text-[13px] text-success">
                <CalendarCheck className="size-3.5 shrink-0" strokeWidth={2.2} />
                <span className="font-semibold">Follow-up booked:</span>
                <span>
                  {format.format(new Date(m.nextFollowUpAt))} {zoneLabel}
                  {theirTime(m.nextFollowUpAt, m) &&
                    ` · ${theirTime(m.nextFollowUpAt, m)} their time`}
                </span>
              </p>
            )}

            {m.callBack && m.callBack.tries > 0 && (
              <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
                Tried {m.callBack.tries}{" "}
                {m.callBack.tries === 1 ? "time" : "times"} with no answer
              </p>
            )}
            {/* The note on the call back in the same labelled box as the demo
                notes below it (2026-10-02). It was a line of 12px grey text
                under the time, so what a prospect had just said ("busy season
                picks up in January, call December 1st") was the smallest
                thing on the card and read as a caption. */}
            {m.callBack?.notes && (
              <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Call back note
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px]">
                  {m.callBack.notes}
                </p>
              </div>
            )}

            {/* Who is taking it (2026-09-25). A founder hands a meeting to a
                closer here; everyone else only needs telling when it is theirs.
                Not offered on a cancelled booking, which nobody takes. */}
            {showWho && closers.length > 0 && m.status !== "cancelled" && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Handshake className="size-3.5 shrink-0" />
                <span>Closing it:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy === m.id}
                    className="rounded-md border px-2 py-0.5 font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {m.closerName ?? "Founders"}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Who takes this meeting?</DropdownMenuLabel>
                    <p className="max-w-64 px-2 pb-1.5 text-[12px] leading-snug text-muted-foreground">
                      A closer can then log what happened, draft the contracts
                      and log the follow-up on it. Nobody else&apos;s meetings.
                    </p>
                    <DropdownMenuItem
                      onSelect={() => void assignCloser(m, null)}
                    >
                      Founders
                    </DropdownMenuItem>
                    {closers.map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onSelect={() => void assignCloser(m, c)}
                      >
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {!showWho && closes && (
              <p className="mt-2 rounded-md bg-primary/10 px-3 py-2 text-[13px] font-medium text-primary">
                Yours to close. A founder gave you this meeting: take the call,
                then log what happened
                {m.kind === "demo" ? " once it has started" : ""}. Closing the
                Demo in Scripts has the steps.
              </p>
            )}

            {/* A caller reads their prospect's name on a follow-up and asks
                whether to ring them (2026-09-24). It is the founders' call
                after the demo, so say so where the eye lands. */}
            {!showWho && !closes && m.kind === "follow_up" && (
              <p className="mt-2 rounded-md bg-success/10 px-3 py-2 text-[13px] font-medium text-success">
                Founders&apos; call. A founder rings them back after the demo,
                so there is nothing for you to do here.
              </p>
            )}

            {/* The one call this screen asks for, and the reason it is worth
                making is written on it: somebody who agreed to a slot and then
                missed it is warm, and the reason is usually something ordinary
                that a new time fixes. Written as what to say rather than as a
                status, like the dial card's booking steps. */}
            {m.needsRingBack && (
              <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px]">
                <span className="font-bold">They did not turn up.</span>{" "}
                Ring
                them, ask what happened, and put a new time in while you have
                them. Log it below either way. That is what takes this off your
                list.
              </p>
            )}

            {/* Over, and nobody has said what happened (2026-09-25). It
                used to drop off this screen at twelve hours and only be found
                in Past meetings. */}
            {m.needsLogging && (
              <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px]">
                <span className="font-bold">Not logged yet.</span>{" "}
                {m.kind === "follow_up"
                  ? "Nobody has said what came of this follow-up. Use Log what happened below. It stays here until it is logged."
                  : "Nobody has said what happened at this demo. Use Log what happened below. It decides the caller's attendance fee, and it stays here until it is answered."}
              </p>
            )}

            {m.leadId === null && (
              // Never hidden. A booking we could not attach to a lead is the
              // one most likely to be forgotten, and saying so is how it gets
              // fixed rather than quietly dropped.
              <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
                Not linked to a lead, so there is no number to ring from here.
                It was booked without the phone number in the notes.
              </p>
            )}

            {m.followup && (
              <p className="mt-2 text-[13px]">
                <span
                  className={cn(
                    "font-semibold",
                    // Rebooked is the win here, not "confirmed" — that value
                    // belonged to the confirmation call this replaced.
                    m.followup.result === "rescheduled" && "text-success",
                    (m.followup.result === "cancelled" ||
                      m.followup.result === "no_answer") &&
                      "text-destructive",
                  )}
                >
                  {FOLLOWUP_DONE[m.followup.result]}
                </span>
                {m.followup.byName && ` by ${m.followup.byName}`}
                <span suppressHydrationWarning>
                  {` · ${when(m.followup.at, now)}`}
                </span>
              </p>
            )}

            {/* What the demo turned up, whichever way it went. First because it
                happened first: the ring back below is the call that follows it.

                Both boxes are labelled now that there are two of them. Two
                unlabelled grey blocks on one row leave a founder guessing which
                call they are reading — the same reason the two play buttons say
                "Cold call" and "Demo call" rather than both saying nothing. */}
            {m.attendanceNotes && (
              <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  From the demo
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px]">
                  {m.attendanceNotes}
                </p>
              </div>
            )}

            {/* What that call turned up. Shown like the booking notes rather
                than folded away: the founder walking into the demo reads this
                row and nothing else. */}
            {m.followup?.notes && (
              <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  From the ring back
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px]">
                  {m.followup.notes}
                </p>
              </div>
            )}


            {!cancelled && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Straight to the dial card — the only screen with the
                    number, the business, the booking notes and the outcome
                    buttons in one place. Copying the number onto the Keypad
                    instead leaves a caller talking to a number with no idea
                    who it is, and coming back here afterwards drops the call.
                    Absent on an unlinked booking, which belongs to no niche
                    and so has no dialler to open. */}
                {/* What happened at the demo, logged where the demo is —
                    rather than only on Payroll, which a founder opens on a
                    Friday. It is the answer the ring back hangs off: nothing
                    can ask anybody to chase a no-show until somebody has said
                    it was one. Offered from the moment it starts, since that is
                    when it is either happening or not. */}
                {/* Founders can answer before it starts (2026-09-25): a
                    booking that is not real is written off while it is still
                    in the diary, rather than sitting in everybody's reminders
                    until its slot passes. A closer answers once it begins. */}
                {/* Any meeting linked to a business (2026-09-25). One booked
                    with no call behind it is answered against the meeting,
                    pays nobody, and is a founder's alone to answer. */}
                {closes && (showWho || hasStarted) && m.leadId !== null &&
                  (m.bookingCallId !== null || showWho) &&
                  m.kind === "demo" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={busy === m.id}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-50",
                        m.attendance
                          ? "border hover:bg-muted"
                          : "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      <ClipboardCheck className="size-3.5" />
                      {m.attendance ? "Change it" : "Log what happened"}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>Did they turn up?</DropdownMenuLabel>
                      {/* The bar, in front of the person answering it. The
                          demo is a phone call now, so "turned up" needed
                          saying: this answer is what the caller is paid on. */}
                      <p className="max-w-60 px-2 pb-1.5 text-[12px] leading-snug text-muted-foreground">
                        {hasStarted
                          ? "Showed up means they picked up and stayed on while the agent was brought in. Ringing out or voicemail is a no show. Picked up but could not talk now? Move it to a new time from More instead."
                          : "This has not started yet. Answer now only to write off a booking that is not real. Moving the meeting to a new time clears the answer."}
                      </p>
                      {(
                        Object.keys(ATTENDANCE_LABEL) as DemoStatus[]
                      ).map((sVal) => (
                        <DropdownMenuItem
                          key={sVal}
                          onSelect={() =>
                            setAnswering({
                              meetingId: m.id,
                              status: sVal,
                              notes: m.attendanceNotes ?? "",
                            })
                          }
                        >
                          {ATTENDANCE_LABEL[sVal]}
                        </DropdownMenuItem>
                      ))}
                      {/* Withdraw the answer (2026-10-03): a No show logged on
                          the wrong meeting could be changed but never taken
                          back. Once a payout has claimed it the money is out,
                          so it says why it cannot go. */}
                      {m.attendance && (
                        <>
                          <DropdownMenuSeparator />
                          {m.attendancePaid ? (
                            <p className="max-w-60 px-2 py-1.5 text-[12px] leading-snug text-muted-foreground">
                              This answer has been paid on, so it cannot be undone here.
                            </p>
                          ) : (
                            <DropdownMenuItem onSelect={() => void undoAnswer(m)}>
                              <Undo2 className="size-3.5" />
                              Undo: back to not answered
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* What came of a follow-up (2026-09-25). It had no logger of
                    its own, so a follow-up that happened sat unrecorded and was
                    never counted as not logged. Same outcomes and same call
                    row as "Log a follow-up" on the demo; logging one is what
                    marks it done. */}
                {closes && m.kind === "follow_up" && hasStarted && m.leadId !== null && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={busy === m.id}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-50",
                        m.logged
                          ? "border hover:bg-muted"
                          : "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      <ClipboardCheck className="size-3.5" />
                      {m.logged ? "Log another call" : "Log what happened"}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>How did the follow-up go?</DropdownMenuLabel>
                      <p className="max-w-60 px-2 pb-1.5 text-[12px] leading-snug text-muted-foreground">
                        Following up, trial, won and lost are logged as a call.
                        No answer sets a reminder to ring them back and logs
                        nothing.
                      </p>
                      {FOLLOW_UP_OUTCOMES.map((o) => (
                        <DropdownMenuItem
                          key={o}
                          onSelect={() => pickFollowUp(m, o)}
                        >
                          {o === "no_answer" && showWho ? "No answer, ring them back" : OUTCOME_LABELS[o]}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void drop(m, false)}>
                        Not a real booking
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Book the next call from the row the last one is on, rather
                    than opening Cal.com and typing the prospect in again. The
                    link is prefilled exactly as the demo's is — that notes
                    line is load-bearing, since the sync matches a booking back
                    to its lead by the number in it. A new tab, never a
                    navigation: Cal.com's own flow sends the invite. */}
                {/* On a follow-up too (2026-09-25): the call after it had no
                    button, so booking it meant "Move this call", which cancels
                    the one that happened and strands what was logged on it. */}
                {closes && followUpBookingUrl && m.leadId !== null &&
                  hasStarted && (
                  <a
                    href={calBookingHref(
                      followUpBookingUrl,
                      // Their own clock, worked out the way the row's label
                      // is: where the business actually is, and the zone the
                      // last booking form was open in only if we have nothing
                      // better. Off `attendeeTz` alone this offered a Maui
                      // prospect slots on a Singapore clock.
                      {
                        company: m.company,
                        phone: m.phone ?? "",
                        tz: theirZone,
                      },
                      { name: m.attendeeName, email: m.attendeeEmail },
                    )}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
                  >
                    <CalendarPlus className="size-3.5 shrink-0" strokeWidth={2.2} />
                    {m.nextFollowUpAt ? "Book another follow-up" : "Book a follow-up"}
                  </a>
                )}
                {/* The call after the demo — the mock-up call and whatever
                    follows it. Founders only, because they are the ones who
                    make it, and only while the sale is still open: the row
                    stops offering it the moment one says trial, won or lost.
                    Unlike the no-show ring back, this writes a real call. */}
                {closes && m.needsFollowUp && m.leadId !== null && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={busy === m.id}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <ClipboardCheck className="size-3.5" />
                      Log a follow-up
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>
                        What came of the follow-up call?
                      </DropdownMenuLabel>
                      <p className="max-w-60 px-2 pb-1.5 text-[12px] leading-snug text-muted-foreground">
                        Following up, trial, won and lost are logged as a call.
                        No answer sets a reminder to ring them back and logs
                        nothing.
                      </p>
                      {FOLLOW_UP_OUTCOMES.map((o) => (
                        <DropdownMenuItem
                          key={o}
                          onSelect={() => pickFollowUp(m, o)}
                        >
                          {o === "no_answer" && showWho ? "No answer, ring them back" : OUTCOME_LABELS[o]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Rings from here rather than sending you to the lead's dial
                    card and asking for a second press. The redirect was a
                    leftover from when the diary could not dial at all, and it
                    is what split the call from the outcome: you rang on one
                    screen and said how it went on another, so the recording had
                    nothing to attach to. */}
                {/* A no-show is the founders' to follow up (2026-09-24), so a
                    caller is told there is nothing to do rather than handed
                    a button that rings them. */}
                {!showWho && m.attendance === "no_show" ? (
                  <p className="text-[12px] text-muted-foreground">
                    No show. A founder follows these up, so there is nothing
                    for you to do here.
                  </p>
                ) : (
                <MeetingCallButton
                  who={m.company ?? m.attendeeName ?? "this prospect"}
                  to={m.dialTo}
                  from={m.dialFrom}
                  leadId={m.leadId}
                  rowKey={`meeting:${m.id}`}
                  blocked={m.dncBlock}
                  note={
                    m.callBack
                      ? "Your call back, after they missed the demo."
                      : m.needsRingBack
                        ? "They did not turn up to this one."
                        : undefined
                  }
                  label={m.needsRingBack ? "Ring them back" : "Call them"}
                  lines={lines}
                />
                )}
                {/* For after a call nobody picked up. Opens a box under the
                    row with the words already in it; nothing is sent until
                    Send is pressed there. */}
                {textable && (
                  <button
                    type="button"
                    disabled={busy === m.id}
                    aria-expanded={composing?.meetingId === m.id}
                    onClick={() =>
                      setComposing(
                        composing?.meetingId === m.id
                          ? null
                          : { meetingId: m.id, body: textDraft(m) },
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <MessageSquare className="size-3.5" />
                    Text them
                  </button>
                )}
                {/* The repair for an address typed wrong on the booking form.
                    Named for the problem rather than for what Cal.com calls it
                    ("add a guest"), because nobody on the floor is looking for
                    a guest — they are looking for the prospect who never got
                    the invitation. The panel says what it can and cannot do.
                    Shown on every live booking, not only the mismatched ones:
                    a wrong address the CRM also holds looks perfectly fine
                    here, which is the Safe Movers case. */}
                {/* Out on the row only when the two addresses disagree, which
                    is the case worth shouting about; otherwise it is in More. */}
                {canInvite && emailMismatch && (
                  <button
                    type="button"
                    disabled={busy === m.id}
                    aria-expanded={inviting?.meetingId === m.id}
                    onClick={() =>
                      setInviting(
                        inviting?.meetingId === m.id
                          ? null
                          : {
                              meetingId: m.id,
                              // The CRM's own record when it disagrees with
                              // the booking — the corrected one, in the case
                              // this exists for. Otherwise empty rather than
                              // the booking's address, which is the value
                              // being replaced and cannot be sent again.
                              email: emailMismatch ? (m.leadEmail ?? "") : "",
                            },
                      )
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50",
                      emailMismatch && "border-primary/40 text-primary",
                    )}
                  >
                    <Mail className="size-3.5" />
                    Wrong email?
                  </button>
                )}
                {/* Only after a missed demo. There is nothing to log before
                    one: Cal.com tells the prospect it is coming, the sync
                    brings a cancellation or a new time back on its own, and
                    what happened at the meeting is the button above. */}
                {m.needsRingBack && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy === m.id}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <PhoneOutgoing className="size-3.5" />
                    Log the ring back
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>How did it go?</DropdownMenuLabel>
                    {(
                      Object.keys(RING_BACK_LABELS) as MeetingFollowupResult[]
                    ).map((r) => (
                      <DropdownMenuItem
                        key={r}
                        onSelect={() =>
                          setPicked({ meetingId: m.id, result: r, notes: "" })
                        }
                      >
                        {RING_BACK_LABELS[r]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                )}
                {/* The meeting's outcome as it is rung back (2026-09-24): the
                    ring-back logger's own four answers, so a no-show reads the
                    same whoever followed it up. Two of them ask when to ring
                    next and move the call back there. */}
                {showWho && m.callBack && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={busy === m.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      <ClipboardCheck className="size-3.5" />
                      Log the call back
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>How did it go?</DropdownMenuLabel>
                      <DropdownMenuItem
                        onSelect={() => setPrompt({ m, mode: "no_answer" })}
                      >
                        {RING_BACK_LABELS.no_answer}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setPrompt({ m, mode: "spoke" })}
                      >
                        {RING_BACK_LABELS.confirmed}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => void closeCallBack(m, "rescheduled")}
                      >
                        {RING_BACK_LABELS.rescheduled}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => void closeCallBack(m, "cancelled")}
                      >
                        {RING_BACK_LABELS.cancelled}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Everything used now and then, in one menu (2026-09-28):
                    "theres so many buttons". The row keeps what is done on
                    most visits: log what happened, call, text, contracts. */}
                {(() => {
                  const canMove =
                    m.attendance !== "showed_up" &&
                    !(m.kind === "follow_up" && m.logged);
                  const reschedule =
                    rescheduleBase && canMove
                      ? calRescheduleHref(rescheduleBase, m.calBookingUid, theirZone)
                      : null;
                  // Moving quietly tells nobody anything, so it is offered on a
                  // follow-up even once a call is logged on it (2026-09-28: a
                  // one-minute call had hidden it on 1 Tree Zone). Not on a
                  // demo they turned up to: that happened, and moving it would
                  // ask "did they turn up" again. One on a founders' call back
                  // moves with Change the call back time instead.
                  const quiet =
                    closes && m.attendance !== "showed_up" && !m.callBack;
                  return (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={busy === m.id}
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <MoreHorizontal className="size-3.5" />
                        More
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-56">
                        {(quiet || reschedule) && (
                          <DropdownMenuLabel>Change the meeting time</DropdownMenuLabel>
                        )}
                        {quiet && (
                          <DropdownMenuItem onSelect={() => setMovingQuietly(m)}>
                            <Clock className="size-3.5" />
                            <span className="flex flex-col">
                              Move this meeting to a new time
                              <span className="text-[11px] text-muted-foreground">
                                Same meeting, new time. In the CRM only, nothing is sent.
                              </span>
                            </span>
                          </DropdownMenuItem>
                        )}
                        {reschedule && (
                          <DropdownMenuItem asChild>
                            <a
                              href={reschedule}
                              target="_blank"
                              rel="noreferrer noopener"
                              // A booking made before 11 Sep has no "Best number
                              // to call you on", and Cal.com asks for one when it
                              // is moved; a reschedule ignores prefill, so the
                              // number goes onto the clipboard as the page opens.
                              // Never when it is blocked.
                              onClick={() => {
                                if (m.attendeePhone || !m.dialTo || m.dncBlock) return;
                                const number = m.dialTo;
                                void navigator.clipboard
                                  .writeText(number)
                                  .then(() =>
                                    toast.success(`Their number is copied: ${number}`, {
                                      description:
                                        "This booking has no phone number on it. Paste it into “Best number to call you on” on Cal.com.",
                                      duration: 12_000,
                                    }),
                                  )
                                  .catch(() => {});
                              }}
                            >
                              <CalendarClock className="size-3.5" />
                              <span className="flex flex-col">
                                Reschedule on Cal.com
                                <span className="text-[11px] text-muted-foreground">
                                  Same meeting, new time. Cal.com emails them.
                                </span>
                              </span>
                            </a>
                          </DropdownMenuItem>
                        )}
                        {/* The other thing, and the one that gets confused with
                            moving: the meeting stays exactly as it was and a
                            separate call back is added. Founders only. */}
                        {showWho && (m.callBack || (hasStarted && m.status !== "cancelled")) && (
                          <>
                            {(quiet || reschedule) && <DropdownMenuSeparator />}
                            <DropdownMenuLabel>Ring them back later</DropdownMenuLabel>
                            {m.callBack ? (
                              <DropdownMenuItem onSelect={() => setPrompt({ m, mode: "move" })}>
                                <Clock className="size-3.5" />
                                <span className="flex flex-col">
                                  Change the call back time
                                  <span className="text-[11px] text-muted-foreground">
                                    The meeting stays as it was.
                                  </span>
                                </span>
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onSelect={() => setPrompt({ m, mode: "new" })}
                              >
                                <PhoneForwarded className="size-3.5" />
                                <span className="flex flex-col">
                                  Set a call back
                                  <span className="text-[11px] text-muted-foreground">
                                    The meeting stays as it was. Adds a call back at a time you pick.
                                  </span>
                                </span>
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        {(quiet || reschedule || (showWho && (m.callBack || hasStarted))) && (
                          <DropdownMenuSeparator />
                        )}
                        {m.listId !== null && m.leadId !== null && !m.dncBlock && (
                          <DropdownMenuItem asChild>
                            <Link href={`/calls/${m.listId}?view=all&open=0&lead=${m.leadId}`}>
                              <PhoneCall className="size-3.5" />
                              Open lead
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {m.phone &&
                          (m.dncBlock ? (
                            <DropdownMenuItem disabled title={m.dncBlock}>
                              <ShieldAlert className="size-3.5" />
                              Do not call
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => {
                                const number = dialableNumber(m.phone!);
                                void navigator.clipboard
                                  .writeText(number)
                                  .then(() => toast.success(`Copied ${number}`))
                                  .catch(() =>
                                    toast.error("Could not copy: select the number and copy it."),
                                  );
                              }}
                            >
                              <Copy className="size-3.5" />
                              Copy {m.phone}
                            </DropdownMenuItem>
                          ))}
                        <DropdownMenuItem
                          onSelect={() => {
                            void navigator.clipboard
                              .writeText(FORM_URL)
                              .then(() => toast.success("Form link copied"))
                              .catch(() =>
                                toast.error("Could not copy: select the link and copy it."),
                              );
                          }}
                        >
                          <FileText className="size-3.5" />
                          Copy form link
                        </DropdownMenuItem>
                        {canInvite && !emailMismatch && (
                          <DropdownMenuItem
                            onSelect={() =>
                              setInviting({ meetingId: m.id, email: "" })
                            }
                          >
                            <Mail className="size-3.5" />
                            Wrong email? Re-send the invite
                          </DropdownMenuItem>
                        )}
                        {/* Founders only: a one-tap join into a live client
                            demo, which is no caller's business. */}
                        {showWho && m.meetingUrl && (
                          <DropdownMenuItem asChild>
                            <a href={m.meetingUrl} target="_blank" rel="noreferrer noopener">
                              <Video className="size-3.5" />
                              Meet link
                            </a>
                          </DropdownMenuItem>
                        )}
                        {closes && (
                          <>
                            <DropdownMenuSeparator />
                            {m.kind === "follow_up" && !hasStarted && (
                              <DropdownMenuItem onSelect={() => void drop(m, false)}>
                                <CalendarX2 className="size-3.5" />
                                Not a real booking
                              </DropdownMenuItem>
                            )}
                            {m.leadId !== null && (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => void drop(m, true)}
                              >
                                <UserX className="size-3.5" />
                                <span className="flex flex-col">
                                  Remove from Meetings
                                  <span className="text-[11px] text-muted-foreground">
                                    Wasting our time. Marks the sale lost.
                                  </span>
                                </span>
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })()}
                {/* The trial is signed but the sale still reads as earlier
                    (2026-09-25). A contract signed between calls had nowhere
                    to be logged on this screen: a follow-up's logger waits
                    for its time, and the demo row's goes once a follow-up is
                    booked. Writes the same call row the loggers do. */}
                {closes && m.leadId !== null &&
                  m.contracts.some((c) => c.kind === "trial" && c.signedAt) &&
                  !["trial", "won", "lost"].includes(m.leadOutcome ?? "") && (
                  <button
                    type="button"
                    disabled={busy === m.id}
                    onClick={() =>
                      void logFollowUp(m, "trial", "Signed the trial agreement.")
                    }
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    <ClipboardCheck className="size-3.5" />
                    Mark as trial
                  </button>
                )}
                {/* Both agreements, drafted before the demo starts. Hidden
                    entirely where DocuSeal is not configured, in the same
                    spirit as the push toggle: a dead button on a screen
                    somebody works from is worse than no button. */}
                {signingBase && closes && (
                  <PrepareContracts
                    meeting={m}
                    tz={tz}
                    signingBase={signingBase}
                    // Same flag the "who booked it" line runs on: an admin.
                    // Drafting is open to a founder and to the closer a
                    // meeting was handed to; undoing a draft is founders only,
                    // since it takes our only pointer to a real document with
                    // it.
                    canDiscard={showWho}
                  />
                )}
              </div>
            )}

            {/* A time they asked to be rung back, read from a call's
                transcript (2026-10-02). A suggestion with one tap, never a
                call back made behind anybody's back: "around twelve" does not
                say which day or whose clock, and the dialog shows the time on
                both before anything is saved. Founders only; it is gone once a
                call back is open, the time has passed, or a later call has
                been recorded with them. */}
            {showWho && m.callbackSuggestion && !m.callBack && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[13px]">
                <PhoneForwarded className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0">
                  {/* Their day and time first (2026-10-03). "Friday at noon"
                      said by a prospect in Florida is Saturday 12:00 AM in
                      Singapore, and the row led with Singapore, so a correct
                      suggestion read as the prospect asking for a Saturday.
                      The caller's own clock follows in brackets. */}
                  {theirTime(m.callbackSuggestion.at, m) && theirZone ? (
                    <>
                      <span className="font-semibold">
                        They asked to be rung{" "}
                        {new Intl.DateTimeFormat("en-US", {
                          timeZone: theirZone,
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(m.callbackSuggestion.at))}{" "}
                        their time
                      </span>{" "}
                      <span className="text-muted-foreground">
                        ({format.format(new Date(m.callbackSuggestion.at))}{" "}
                        {zoneLabel} for you)
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">
                        They asked to be rung{" "}
                        {format.format(new Date(m.callbackSuggestion.at))}
                      </span>{" "}
                      <span className="text-muted-foreground">{zoneLabel}</span>
                    </>
                  )}
                  {m.callbackSuggestion.quote && (
                    <span className="block text-[12px] text-muted-foreground">
                      &ldquo;{m.callbackSuggestion.quote}&rdquo;
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  className="ml-auto h-7 px-2.5 text-[12px]"
                  onClick={() =>
                    setPrompt({
                      m,
                      mode: "new",
                      at: m.callbackSuggestion!.at,
                      notes: m.callbackSuggestion!.quote
                        ? `They said: "${m.callbackSuggestion!.quote}"`
                        : "",
                    })
                  }
                >
                  Check the time and set it
                </Button>
              </div>
            )}

            {/* The recordings on a line of their own, under the actions
                rather than mixed in with them (2026-09-28). */}
            {(m.recordingId && keep(m.recordingMs)) ||
            earlierDemo.length > 0 ||
            ownRecordings.length > 0 ||
            otherCalls.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-muted-foreground">
                  Recordings
                </span>
                {/* The same sheet the call log opens: audio, and a transcript
                    whose turns seek it. Made on request in there, not here. */}
                {/* "Cold call", not "Listen back": this is the call that won
                    the booking, read off the `demo_booked` call's session in
                    `meetings.ts` — the same recording the notes below it came
                    from. Naming it matters now that the demo itself is also
                    recorded, because two unlabelled play buttons on one row
                    would leave a founder guessing which call they were about
                    to hear. */}
                {m.recordingId && keep(m.recordingMs) && (
                  <LogRecording
                    recordingId={m.recordingId}
                    recordingMs={m.recordingMs}
                    company={m.company ?? m.attendeeName ?? "Booking call"}
                    callerName={m.bookedBy ?? "Caller"}
                    label="Cold call"
                  />
                )}
                {/* The demo itself. Matched by the prospect's number around the
                    booked time rather than by a session id, because the demo
                    call usually has no `call` row to carry one — a founder
                    mid-demo is talking, not tapping an outcome, and a row is
                    only written when one is logged.

                    `callerName` labels the near side of the transcript, and it
                    is deliberately not `bookedBy`: that is whoever made the
                    cold call, which is rarely whoever took the demo. Who ran it
                    is not recorded anywhere — the missing row again — and demos
                    are run from the Founders line, so that is the one honest
                    answer available rather than a name that would be wrong.

                    Every recording in the window gets its own button, oldest
                    first, not only the longest — asked for 2026-09-23: "for
                    calls where i call the meeting back multiple times... it
                    only shows one part." A demo that drops and gets redialled
                    is two Telnyx sessions, and `demoRecordings` now carries
                    both rather than the query silently picking the longer one
                    and discarding what is usually the first half of the real
                    conversation. Numbered from the second one on — a single
                    recording still just says "Demo call", since counting a
                    demo that was never interrupted would be answering a
                    question nobody asked. */}
                {/* On a follow-up, the demo it follows (2026-09-25): that
                    row has left the screen, and this is the call worth hearing
                    again before ringing them. Before this row's own call. */}
                {earlierDemo.map((rec, i) => (
                  <LogRecording
                    key={rec.recordingId}
                    recordingId={rec.recordingId}
                    recordingMs={rec.durationMs}
                    startedAt={
                      rec.startedAt
                        ? `${format.format(new Date(rec.startedAt))} ${zoneLabel}`
                        : null
                    }
                    company={m.company ?? m.attendeeName ?? "Demo call"}
                    callerName="Founders"
                    label={i === 0 ? "Demo call" : `Demo call ${i + 1}`}
                  />
                ))}
                {ownRecordings.map((rec, i) => {
                  // This meeting's own call: the demo on a demo, and on a
                  // follow-up the follow-up call, which is not a demo.
                  const name = m.kind === "follow_up" ? "Follow-up call" : "Demo call";
                  return (
                    <LogRecording
                      key={rec.recordingId}
                      recordingId={rec.recordingId}
                      recordingMs={rec.durationMs}
                      startedAt={
                        rec.startedAt
                          ? `${format.format(new Date(rec.startedAt))} ${zoneLabel}`
                          : null
                      }
                      company={m.company ?? m.attendeeName ?? name}
                      callerName="Founders"
                      label={i === 0 ? name : `${name} ${i + 1}`}
                    />
                  );
                })}
                {/* Every other call with this number, founders only: ones
                    nobody logged an outcome on and that fall outside every
                    meeting's window, like a quick call to rearrange a time.
                    Oldest first, dated, because without a date several of
                    them are indistinguishable. */}
                {otherCalls.map((rec) => (
                  <LogRecording
                    key={rec.recordingId}
                    recordingId={rec.recordingId}
                    recordingMs={rec.durationMs}
                    startedAt={
                      rec.startedAt
                        ? `${format.format(new Date(rec.startedAt))} ${zoneLabel}`
                        : null
                    }
                    company={m.company ?? m.attendeeName ?? "Other call"}
                    callerName={rec.byName ?? "Caller"}
                    label={
                      rec.byName
                        ? `${rec.direction === "in" ? "They called" : "Call"} (${rec.byName})`
                        : rec.direction === "in"
                          ? "They called"
                          : "Other call"
                    }
                  />
                ))}
                {/* Where they asked to be rung back on a call nothing else
                    recorded. A call back is otherwise only made by marking a
                    no-show, so a promise made on a quick call had nowhere to
                    live. Founders, and only where there is no call back yet:
                    one already open is changed from More. */}
                {showWho && !m.callBack && m.status !== "cancelled" && otherCalls.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[12px]"
                    onClick={() => {
                      const last = otherCalls[otherCalls.length - 1];
                      setPrompt({
                        m,
                        mode: "new",
                        notes: last.startedAt
                          ? `From the call on ${format.format(new Date(last.startedAt))} ${zoneLabel}: `
                          : "",
                      });
                    }}
                  >
                    <PhoneForwarded className="size-3.5" />
                    Ring them back later
                  </Button>
                )}
              </div>
            ) : null}

            {/* What the demo turned up, before the answer is saved. Deliberately
                the same box, in the same place, with the same two buttons as the
                ring back logger below: two loggers on one row that behaved
                differently would be a thing to learn twice. */}
            {answering?.meetingId === m.id && (
              <div className="mt-3 rounded-lg border bg-background p-3">
                <p className="text-[13px] font-bold">
                  {ATTENDANCE_LABEL[answering.status]}
                </p>
                <Textarea
                  autoFocus
                  value={answering.notes}
                  onChange={(e) =>
                    setAnswering({ ...answering, notes: e.target.value })
                  }
                  placeholder="What happened? Who you spoke to, the best time to try again. (optional)"
                  className="mt-2 min-h-[64px]"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy === m.id}
                    onClick={() => mark(m, answering.status, answering.notes)}
                  >
                    {busy === m.id ? "Saving…" : "Log it"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === m.id}
                    onClick={() => setAnswering(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {following?.meetingId === m.id && (
              <div className="mt-3 rounded-lg border bg-background p-3">
                <p className="text-[13px] font-bold">
                  {OUTCOME_LABELS[following.outcome]}
                </p>
                <Textarea
                  autoFocus
                  value={following.notes}
                  onChange={(e) =>
                    setFollowing({ ...following, notes: e.target.value })
                  }
                  placeholder="What did they say? What the mock-up showed, what they want changed, when to ring again. (optional)"
                  className="mt-2 min-h-[64px]"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy === m.id}
                    onClick={() =>
                      logFollowUp(m, following.outcome, following.notes)
                    }
                  >
                    {busy === m.id ? "Saving…" : "Log the call"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === m.id}
                    onClick={() => setFollowing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* What the call turned up, before it is logged. Under the row
                rather than in a dialog, so the booking notes and the time stay
                readable while it is written. */}
            {picked?.meetingId === m.id && (
              <div className="mt-3 rounded-lg border bg-background p-3">
                <p className="text-[13px] font-bold">
                  {RING_BACK_LABELS[picked.result]}
                </p>
                <Textarea
                  autoFocus
                  value={picked.notes}
                  onChange={(e) =>
                    setPicked({ ...picked, notes: e.target.value })
                  }
                  placeholder="What did they say? New time, if you set one. (optional)"
                  className="mt-2 min-h-[64px]"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy === m.id}
                    onClick={() => log(m, picked.result, picked.notes)}
                  >
                    {busy === m.id ? "Saving…" : "Log it"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === m.id}
                    onClick={() => setPicked(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Sending the invitation somewhere else.

                Every word here is doing work. A caller who reads this as "I
                fixed the email" will not ring to check the prospect got
                anything, and the booking will still be carrying the wrong
                address when the contract goes out. */}
            {inviting?.meetingId === m.id && (
              <div className="mt-3 rounded-lg border bg-background p-3">
                <p className="text-[13px] font-bold">
                  Send the invitation to another email
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Cal.com will not let the email on a booking be changed, so
                  this sends the invitation to the right address instead. They
                  get the calendar invite and the reminders.{" "}
                  <span className="font-semibold">
                    The old address stays on the booking
                  </span>{" "}
                  and keeps getting Cal.com&apos;s emails. Only cancelling and
                  booking again removes it, and that is rarely worth it.
                </p>
                <Input
                  autoFocus
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="name@company.com"
                  value={inviting.email}
                  onChange={(e) =>
                    setInviting({ ...inviting, email: e.target.value })
                  }
                  className="mt-2"
                />
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  Saved as this business&apos;s email too, so the next booking
                  and the contract use it.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy === m.id || !inviting.email.trim()}
                    onClick={() => sendInvite(m, inviting.email.trim())}
                  >
                    {busy === m.id ? "Sending…" : "Send the invitation"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === m.id}
                    onClick={() => setInviting(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {texting && composing?.meetingId === m.id && (
              <div className="mt-3 rounded-lg border bg-background p-3">
                {!texting.from ? (
                  <p className="text-[13px]">
                    <span className="font-bold">
                      You have no US number to text from.
                    </span>{" "}
                    A text goes out from your own calling number, so it comes
                    from the number that just rang them. Give your account a US
                    number on Team.
                  </p>
                ) : lead?.optedOut ? (
                  <p className="text-[13px]">
                    <span className="font-bold">They replied STOP.</span>{" "}
                    Telnyx will not send them any more texts, so ring them
                    instead.
                  </p>
                ) : (
                  <>
                    <p className="text-[13px] font-bold">
                      Text {m.attendeeName ?? m.company ?? "them"}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      From your number {spokenNumber(texting.from)} to{" "}
                      {spokenNumber(m.phone ?? "")}. It goes out exactly as
                      written, with nothing added.
                    </p>
                    <Textarea
                      autoFocus
                      value={composing.body}
                      maxLength={480}
                      onChange={(e) =>
                        setComposing({ ...composing, body: e.target.value })
                      }
                      className="mt-2 min-h-[64px]"
                    />
                    {/* Drops the link in rather than making somebody switch
                        tabs to copy it and paste it back. Each press appends
                        to whatever is already written, so the contract and
                        the form link can both be added to the same text. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {m.contracts.map((c) => (
                        <button
                          key={c.kind}
                          type="button"
                          onClick={() =>
                            setComposing((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    body: appendLink(
                                      prev.body,
                                      `${signingBase}/s/${c.signerSlug}`,
                                    ),
                                  }
                                : prev,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-muted"
                        >
                          <FileSignature className="size-3" />
                          Add {c.kind === "trial" ? "trial" : "paid"} agreement
                          link
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setComposing((prev) =>
                            prev
                              ? { ...prev, body: appendLink(prev.body, FORM_URL) }
                              : prev,
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-muted"
                      >
                        <FileText className="size-3" />
                        Add form link
                      </button>
                    </div>
                  </>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {texting.from && !lead?.optedOut && (
                    <Button
                      size="sm"
                      disabled={busy === m.id || !composing.body.trim()}
                      onClick={() => setConfirmingText(true)}
                    >
                      {busy === m.id ? "Sending…" : "Send text"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === m.id}
                    onClick={() => setComposing(null)}
                  >
                    {texting.from && !lead?.optedOut ? "Cancel" : "Close"}
                  </Button>
                </div>
                {texting.from && (
                  <ConfirmSend
                    open={confirmingText}
                    kind="text"
                    to={{
                      name: m.attendeeName ?? m.company,
                      address: spokenNumber(m.phone ?? ""),
                    }}
                    from={spokenNumber(texting.from)}
                    body={composing.body.trim()}
                    onCancel={() => setConfirmingText(false)}
                    onConfirm={() => {
                      setConfirmingText(false);
                      void sendText(m, composing.body);
                    }}
                  />
                )}
              </div>
            )}

            {/* The whole conversation with this business, oldest first, so a
                reply reads under the text it answers.

                Folded away since 2026-09-16, the same native `details` the
                booking notes use: a long thread pushed the next meeting off
                the screen, and this is a diary read top to bottom. Native so
                it works before hydration and costs no state on a list that
                can be long.

                Shut even when they have replied, because the row already says
                "Texted back" in its chips — the fold repeating that would be
                the noise this removes. The summary carries the count and when
                the last one was, so it is worth reading closed. */}
            {/* What was said on the call that won this meeting, so a founder
                reads it on the row they dial from rather than on the Briefing
                page (2026-09-24). Not on a cancelled booking: there is no
                demo to prepare for. */}
            {briefs && !cancelled && (
              <MeetingBriefFold
                meetingId={m.id}
                initial={briefs[m.id] ?? null}
              />
            )}

            {/* How the demo call went against the NEPQ and Challenger
                checklist (2026-10-03). Only where the demo was recorded, and
                never on a cancelled booking. */}
            {reviews && !cancelled && reviewCalls.length > 0 && (
              <DemoReviewFold
                meetingId={m.id}
                initial={reviews[m.id] ?? null}
                calls={reviewCalls}
                defaultIds={m.demoRecordings.map((r) => r.recordingId)}
              />
            )}

            {/* How the cold call that booked this demo went (2026-10-03). A
                founder on any booking with a recording, a caller only on the
                ones their own call won. */}
            {bookingReviews &&
              !cancelled &&
              m.recordingId &&
              (bookedByMe === null || bookedByMe.includes(m.id)) && (
                <DemoReviewFold
                  kind="booking"
                  meetingId={m.id}
                  initial={bookingReviews[m.id] ?? null}
                />
              )}

            {/* The long calls' summaries in a fold of their own, under the
                briefing (2026-10-02). Shown on a cancelled booking too: its
                recordings are still there to read about. */}
            <CallSummariesFold
              items={[
                // Not when a briefing is written for it above: that is made
                // from this same call, so the fold repeated it (2026-10-03).
                // Only once one exists: with the briefing fold present but
                // still "not written yet", this was the row's only summary
                // and hiding it left the row blank (2026-10-03, Just Junk It
                // 432, Junk Solution, Holzfaller).
                ...(m.recordingSummary && !(briefs && !cancelled && briefs[m.id])
                  ? [
                      {
                        key: "cold",
                        label: "Cold call",
                        durationMs: m.recordingMs,
                        text: m.recordingSummary,
                      },
                    ]
                  : []),
                ...earlierDemo.map((r, i) => ({
                  key: r.recordingId,
                  recordingId: r.recordingId,
                  label: i === 0 ? "Demo call" : `Demo call ${i + 1}`,
                  durationMs: r.durationMs,
                  text: r.summary ?? "",
                })),
                ...ownRecordings.map((r, i) => {
                  const name = m.kind === "follow_up" ? "Follow-up call" : "Demo call";
                  return {
                    key: r.recordingId,
                    recordingId: r.recordingId,
                    label: i === 0 ? name : `${name} ${i + 1}`,
                    durationMs: r.durationMs,
                    text: r.summary ?? "",
                  };
                }),
                ...otherCalls.map((r) => ({
                  key: r.recordingId,
                  recordingId: r.recordingId,
                  label: r.byName
                    ? `${r.direction === "in" ? "They called" : "Call"} (${r.byName})`
                    : "Other call",
                  durationMs: r.durationMs,
                  text: r.summary ?? "",
                })),
              ].filter(
                // A long call is listed even before its summary is written,
                // with a button to write it.
                (x) =>
                  x.text.trim() !== "" ||
                  ("recordingId" in x && (x.durationMs ?? 0) >= LONG_CALL_MS),
              )}
            />

            {lead && lead.texts.length > 0 && (
              <details className="group mt-3 rounded-lg border bg-muted/30">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] font-semibold">
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  Texts
                  <span className="font-normal text-muted-foreground">
                    {lead.texts.length}
                    {" · "}
                    <span suppressHydrationWarning>
                      {when(lead.texts[lead.texts.length - 1].at, now)}
                    </span>
                  </span>
                </summary>
                <ul className="flex flex-col gap-2 border-t px-3 py-2.5">
                  {lead.texts.map((t) => (
                    <li
                      key={t.id}
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-[13px]",
                        t.direction === "out"
                          ? "self-end bg-primary/10"
                          : "self-start border bg-background",
                      )}
                    >
                      {/* Same renderer as the Texts screen. This row showed
                          "[They sent a picture or file]" for an hour after
                          attachments shipped, because it is a second copy of
                          the thread with its own query. */}
                      <TextMedia
                        messageId={t.id}
                        media={t.media}
                        spaced={bubbleText(t.body, t.media.length > 0).length > 0}
                      />
                      <p className="whitespace-pre-wrap break-words">
                        {bubbleText(t.body, t.media.length > 0)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t.direction === "in"
                          ? "They replied"
                          : (t.byName ?? "Sent")}
                        <span suppressHydrationWarning>
                          {` · ${when(t.at, now)}`}
                        </span>
                        {t.direction === "out" && (
                          <span
                            className={cn(
                              t.status === "delivered" && "text-success",
                              t.status === "failed" &&
                                "font-semibold text-destructive",
                            )}
                          >
                            {` · ${TEXT_STATUS[t.status]}`}
                          </span>
                        )}
                      </p>
                      {t.status === "failed" && t.error && (
                        <p className="mt-1 text-[12px] text-destructive">
                          {t.error}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {lead.optedOut && (
                  // Its own bordered strip now the padding lives on the list
                  // above rather than on a wrapper.
                  <p className="border-t px-3 py-2 text-[12px] text-muted-foreground">
                    They replied STOP, so no more texts can go to them.
                  </p>
                )}
              </details>
            )}

            {/*
              The notes from the call that won the meeting.
              Collapsed, because the demo is the thing on this screen and the
              handover is what you open just before walking into one — usually
              a founder taking a demo booked by somebody else, for whom these
              notes are the only briefing there is.

              A native `details`, so it opens before hydration and needs no
              state on a list that can be long. The recording sits in the
              button row above rather than in here: it opens a sheet of its
              own, and burying one behind a fold to reach the other is a tap
              nobody needs.
            */}
            {m.bookingNotes && (
              <details className="group mt-3 rounded-lg border bg-muted/30">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] font-semibold">
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  Notes from the booking call
                  {m.bookedAt && (
                    <span
                      className="font-normal text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {when(m.bookedAt, now)}
                    </span>
                  )}
                </summary>
                {/* Typed by a caller mid-conversation, so the line breaks they
                    left are part of what they wrote. */}
                <p className="whitespace-pre-wrap border-t px-3 py-2.5 text-[13px]">
                  {m.bookingNotes}
                </p>
              </details>
            )}
          </li>
        );
      })}
    </ul>
    {prompt && (
      <CallBackPrompt
        // Remounted per meeting and way in, so a half-typed note never
        // carries over to the next one.
        key={`${prompt.m.id}-${prompt.mode}`}
        mode={prompt.mode}
        initialNotes={prompt.notes}
        initialAt={prompt.at}
        meetingId={prompt.m.id}
        callBackId={prompt.m.callBack?.id}
        name={prompt.m.company ?? prompt.m.attendeeName ?? "They"}
        theirTz={prospectZone(prompt.m.leadTz, prompt.m.attendeeTz)}
        readerTz={tz}
        // The time of day the intervals keep: the demo's for a fresh no-show,
        // the call back's once there is one.
        anchorAt={
          prompt.mode === "no_show"
            ? prompt.m.startAt
            : (prompt.m.callBack?.at ?? prompt.m.startAt)
        }
        onClose={() => setPrompt(null)}
      />
    )}
    {movingQuietly && (
      <MoveQuietly
        key={movingQuietly.id}
        meetingId={movingQuietly.id}
        name={movingQuietly.company ?? movingQuietly.attendeeName ?? "this meeting"}
        theirTz={prospectZone(movingQuietly.leadTz, movingQuietly.attendeeTz)}
        readerTz={tz}
        startAt={movingQuietly.startAt}
        calStartAt={movingQuietly.calStartAt}
        onClose={() => setMovingQuietly(null)}
      />
    )}
    </>
  );
}
