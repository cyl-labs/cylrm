"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CalendarX2,
  ChevronRight,
  Copy,
  PhoneOutgoing,
  ShieldAlert,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { Meeting, MeetingFollowupResult } from "@/lib/meetings";
import { dialableNumber } from "@/lib/phone";
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
import { cn } from "@/lib/utils";
import { LogRecording } from "@/components/calls/log-recording";
import { PrepareContracts } from "@/components/calls/prepare-contracts";
import { CallBackButton } from "@/components/calls/call-back-button";

const FOLLOWUP_LABELS: Record<MeetingFollowupResult, string> = {
  confirmed: "Confirmed — they're coming",
  no_answer: "No answer",
  rescheduled: "Moved to another time",
  cancelled: "They cancelled",
};

/** What a logged chase reads as afterwards. Shorter than the menu labels,
 *  which are written as the answer to "how did the call go". */
const FOLLOWUP_DONE: Record<MeetingFollowupResult, string> = {
  confirmed: "Confirmed",
  no_answer: "No answer",
  rescheduled: "Being moved",
  cancelled: "Cancelled by them",
};

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
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<number | null>(null);
  /**
   * Picked but not yet logged.
   *
   * A chase call is where the awkward detail turns up — they want to move it,
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
        return (
          <li
            key={m.id}
            className={cn(
              "rounded-xl border bg-card p-3.5 sm:p-4",
              // The server's answer, so the border cannot differ between the
              // HTML and the hydration.
              m.needsChase && "border-destructive/40",
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
                    variant={m.needsChase ? "destructive" : "secondary"}
                  >
                    {when(m.startAt)}
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
                    m.followup.result === "confirmed" && "text-success",
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

            {/* What that chase turned up. Shown like the booking notes rather
                than folded away: the founder walking into the demo reads this
                row and nothing else. */}
            {m.followup?.notes && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                {m.followup.notes}
              </p>
            )}

            {m.needsChase && !m.followup && (
              <p className="mt-2 text-[13px] font-semibold text-destructive">
                Ring them to confirm.
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
                {m.listId !== null && m.leadId !== null && !m.dncBlock && (
                  <CallBackButton
                    listId={m.listId}
                    leadId={m.leadId}
                    label="Call to confirm"
                  />
                )}
                {m.phone && (
                  <CopyNumber phone={m.phone} blocked={m.dncBlock} />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy === m.id}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <PhoneOutgoing className="size-3.5" />
                    {m.followup ? "Log another" : "Log the follow-up"}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>How did it go?</DropdownMenuLabel>
                    {(
                      Object.keys(FOLLOWUP_LABELS) as MeetingFollowupResult[]
                    ).map((r) => (
                      <DropdownMenuItem
                        key={r}
                        onSelect={() =>
                          setPicked({ meetingId: m.id, result: r, notes: "" })
                        }
                      >
                        {FOLLOWUP_LABELS[r]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
                {m.meetingUrl && (
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

            {/* What the chase call turned up, before it is logged. Under the
                row rather than in a dialog, so the booking notes and the time
                stay readable while it is written. */}
            {picked?.meetingId === m.id && (
              <div className="mt-3 rounded-lg border bg-background p-3">
                <p className="text-[13px] font-bold">
                  {FOLLOWUP_LABELS[picked.result]}
                </p>
                <Textarea
                  autoFocus
                  value={picked.notes}
                  onChange={(e) =>
                    setPicked({ ...picked, notes: e.target.value })
                  }
                  placeholder="Anything the demo should know? (optional)"
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

            {/*
              What was said on the call that won the meeting.
              Collapsed, because the demo is the thing on this screen and the
              history is what you open when you are about to walk into one —
              usually a founder taking a demo booked by somebody else, for whom
              these notes are the entire handover.

              A native `details`, so it opens before hydration and needs no
              state on a list that can be long. Nothing here is fetched on
              open: it rides along with the meeting, which is cheap because a
              transcript only exists when somebody already paid for one.
            */}
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
