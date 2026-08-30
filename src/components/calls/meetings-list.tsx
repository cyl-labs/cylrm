"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CalendarX2,
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
import { cn } from "@/lib/utils";

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
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<number | null>(null);

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

  async function log(meeting: Meeting, result: MeetingFollowupResult) {
    setBusy(meeting.id);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not log the follow-up.");
        return;
      }
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

            {m.needsChase && !m.followup && (
              <p className="mt-2 text-[13px] font-semibold text-destructive">
                Ring them to confirm.
              </p>
            )}

            {!cancelled && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
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
                      <DropdownMenuItem key={r} onSelect={() => log(m, r)}>
                        {FOLLOWUP_LABELS[r]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
