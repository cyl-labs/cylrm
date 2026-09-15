"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CalendarX2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Globe,
  MessageSquare,
  PhoneOutgoing,
  ShieldAlert,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { Meeting, MeetingFollowupResult } from "@/lib/meetings";
import type { SmsStatus, Texting } from "@/lib/sms";
import { classifyPhone, dialableNumber, spokenNumber } from "@/lib/phone";
import { websiteHref, websiteLabel } from "@/lib/website";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmSend } from "@/components/confirm-send";
import { cn } from "@/lib/utils";
import { LogRecording } from "@/components/calls/log-recording";
import { PrepareContracts } from "@/components/calls/prepare-contracts";
import { CallBackButton } from "@/components/calls/call-back-button";

/**
 * How the ring back after a missed demo ended.
 *
 * The four stored values are unchanged — they were written for a confirmation
 * call that no longer happens — so this is only the words on the menu. Ask the
 * reason, then rebook: "Rebooked" is the answer this call is trying to reach,
 * which is why it is first.
 */
const RING_BACK_LABELS: Record<MeetingFollowupResult, string> = {
  rescheduled: "Rebooked — new time agreed",
  no_answer: "No answer — try again",
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
 * Only ever sent after a demo-time call they did not pick up or that went to
 * voicemail, so it says that and nothing else. Written as the person who just
 * rang, because it is one: no brand prefix, no footer, and no company name,
 * which the founders asked for on 2026-09-15 ("nobody cares"). No sender name
 * either — the founders share one account, so its name ("Founders") is exactly
 * the word that would give the text away as a system.
 */
function textDraft(m: Meeting): string {
  const first = m.attendeeName?.trim().split(/\s+/)[0];
  return `${first ? `Hey ${first}` : "Hey"}, just tried calling you for your demo. I'll call you again now.`;
}

/**
 * How far off it is, in words.
 *
 * Same shape as the callbacks diary's, and the same reason for it: the list is
 * read in a hurry and "in 3h" is what gets acted on. Days are the unit that
 * matters here rather than minutes, since the rule is about tomorrow.
 */
function when(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) {
    const ago = Math.abs(mins);
    if (ago === 0) return "just now";
    return ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
  }
  if (mins < 60) return `in ${mins}m`;
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)}h`;
  return `in ${Math.round(mins / 60 / 24)}d`;
}

function CopyNumber({
  phone,
  blocked,
}: {
  phone: string;
  blocked?: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  // Screening blocks the clipboard, not only a dial button — see dialler.tsx.
  if (blocked) {
    return (
      <span
        className="flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-[13px] font-bold text-muted-foreground"
        title={blocked}
      >
        <ShieldAlert className="size-3.5 shrink-0" strokeWidth={2.2} />
        Do not call
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Copy ${phone}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(dialableNumber(phone));
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Could not copy: select the number and copy it.");
        }
      }}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-bold tabular-nums transition-colors",
        copied
          ? "bg-success text-primary-foreground"
          : "bg-primary/10 text-primary hover:bg-primary/15",
      )}
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={2.6} />
      ) : (
        <Copy className="size-3.5" strokeWidth={2.2} />
      )}
      {copied ? "Copied" : phone}
    </button>
  );
}

export function MeetingsList({
  meetings,
  tz,
  zoneLabel,
  showWho = false,
  signingBase = "",
  texting = null,
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
  /** DocuSeal's public host. Empty when it is not configured, which is what
   *  hides the contract buttons rather than offering ones that cannot work. */
  signingBase?: string;
  /** Texts to the prospect and their replies. Null when texting is switched
   *  off or the reader is not an admin, which draws no button and no thread. */
  texting?: Texting | null;
}) {
  const router = useRouter();
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

  /** Their clock, when it is not ours. What you say the time back to them in
   *  — the thing the SOP makes a caller work out by hand today. */
  const theirTime = React.useCallback(
    (iso: string, theirTz: string | null) => {
      if (!theirTz || theirTz === tz) return null;
      try {
        return new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: theirTz,
        }).format(new Date(iso));
      } catch {
        // An unrecognised zone off the API is not worth an error boundary.
        return null;
      }
    },
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
  async function mark(meeting: Meeting, status: DemoStatus) {
    if (meeting.bookingCallId === null) return;
    setBusy(meeting.id);
    try {
      const res = await fetch("/api/payroll/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: meeting.bookingCallId, status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not save that.");
        return;
      }
      toast.success(
        `${ATTENDANCE_LABEL[status]}: ${meeting.company ?? meeting.attendeeName ?? "meeting"}`,
      );
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
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
        <p className="text-sm font-semibold">No meetings booked.</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          They appear here within a few minutes of being booked on Cal.com.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {meetings.map((m) => {
        const cancelled = m.status === "cancelled";
        const their = theirTime(m.startAt, m.attendeeTz);
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
            className={cn(
              "rounded-xl border bg-card p-3.5 sm:p-4",
              // The server's answer, so the border cannot differ between the
              // HTML and the hydration. It marks what is nearly here, not work
              // owed — there is no confirmation call to owe any more.
              m.startingSoon && "border-primary/40",
              // The only row on this screen that is work owed, so it is the
              // only one that shouts.
              m.needsRingBack && "border-destructive/40",
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
                ) : (
                  // Counts down live, so it can cross a boundary between the
                  // render and the hydration — same note as the board.
                  <Badge
                    suppressHydrationWarning
                    variant={m.startingSoon ? "default" : "secondary"}
                  >
                    {when(m.startAt)}
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

            <p className="mt-1.5 text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                {format.format(new Date(m.startAt))}
              </span>{" "}
              {zoneLabel}
              {/* Their clock, so the time you say back to them is the time
                  they will be sitting down at. */}
              {their && ` · ${their} their time`}
              {showWho && m.bookedBy && (
                <>
                  {" · booked by "}
                  <span className="font-semibold text-foreground">
                    {m.bookedBy}
                  </span>
                </>
              )}
            </p>

            {/* The one call this screen asks for, and the reason it is worth
                making is written on it: somebody who agreed to a slot and then
                missed it is warm, and the reason is usually something ordinary
                that a new time fixes. Written as what to say rather than as a
                status, like the dial card's booking steps. */}
            {m.needsRingBack && (
              <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px]">
                <span className="font-bold">They did not turn up.</span> Ring
                them, ask what happened, and put a new time in while you have
                them. Log it below either way — that is what takes this off your
                list.
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
                  {` · ${when(m.followup.at)}`}
                </span>
              </p>
            )}

            {/* What that call turned up. Shown like the booking notes rather
                than folded away: the founder walking into the demo reads this
                row and nothing else. */}
            {m.followup?.notes && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                {m.followup.notes}
              </p>
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
                {showWho && m.started && m.bookingCallId !== null && (
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
                        Showed up means they picked up and stayed on while the
                        agent was brought in. No answer, or they could not stay,
                        is a no show.
                      </p>
                      {(
                        Object.keys(ATTENDANCE_LABEL) as DemoStatus[]
                      ).map((sVal) => (
                        <DropdownMenuItem
                          key={sVal}
                          onSelect={() => mark(m, sVal)}
                        >
                          {ATTENDANCE_LABEL[sVal]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {m.listId !== null && m.leadId !== null && !m.dncBlock && (
                  <CallBackButton
                    listId={m.listId}
                    leadId={m.leadId}
                    label={m.needsRingBack ? "Ring them back" : "Call them"}
                  />
                )}
                {m.phone && (
                  <CopyNumber phone={m.phone} blocked={m.dncBlock} />
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
                {/* The same sheet the call log opens: audio, and a transcript
                    whose turns seek it. Made on request in there, not here. */}
                {m.recordingId && (
                  <LogRecording
                    recordingId={m.recordingId}
                    recordingMs={m.recordingMs}
                    company={m.company ?? m.attendeeName ?? "Booking call"}
                    callerName={m.bookedBy ?? "Caller"}
                  />
                )}
                {/* Founders only, and not for tidiness: this is a one-tap join
                    into a live client demo. A caller is paid when a booked demo
                    shows up and the demo itself is deliberately none of their
                    business — the same reason `procedure-closing-the-demo` is
                    withheld from them. The failure to avoid is not a caller
                    reading something they should not; it is one wandering into
                    a founder's call while a prospect is on the line. */}
                {showWho && m.meetingUrl && (
                  <a
                    href={m.meetingUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
                  >
                    <Video className="size-3.5" />
                    Meet link
                  </a>
                )}
                {/* Both agreements, drafted before the demo starts. Hidden
                    entirely where DocuSeal is not configured, in the same
                    spirit as the push toggle: a dead button on a screen
                    somebody works from is worse than no button. */}
                {signingBase && (
                  <PrepareContracts
                    meeting={m}
                    tz={tz}
                    signingBase={signingBase}
                    // Same flag the "who booked it" line runs on: an admin.
                    // Drafting is open to whoever owns the meeting; undoing a
                    // draft is not, since it takes our only pointer to a real
                    // document with it.
                    canDiscard={showWho}
                  />
                )}
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
                reply reads under the text it answers. */}
            {lead && lead.texts.length > 0 && (
              <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <MessageSquare className="size-3.5 text-muted-foreground" />
                  Texts
                </p>
                <ul className="mt-2 flex flex-col gap-2">
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
                      <p className="whitespace-pre-wrap break-words">
                        {t.body}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t.direction === "in"
                          ? "They replied"
                          : (t.byName ?? "Sent")}
                        <span suppressHydrationWarning>
                          {` · ${when(t.at)}`}
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
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    They replied STOP, so no more texts can go to them.
                  </p>
                )}
              </div>
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
                      {when(m.bookedAt)}
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
  );
}
