"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Copy,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CALL_TIME_OUTCOMES, OUTCOME_LABELS } from "@/components/calls/outcome";
import { RingBackButton } from "@/components/calls/ring-back-button";
import { useCallLine } from "@/components/calls/call-line";
import {
  callbackZoneLabel,
  defaultCallbackAt,
} from "@/lib/call-time";
import { dialableNumber } from "@/lib/phone";
import type { InboundCall } from "@/lib/inbound";
import type { CallOutcome } from "@/lib/calls";
import { cn } from "@/lib/utils";

/**
 * Who rang, and whether anybody picked up.
 *
 * A missed call is the only thing on this screen that is work, so it is what
 * the list shows by default and what carries the weight visually. The answered
 * ones are a click away — enough that the screen can be read as "what came in
 * today" rather than only as a list of failures.
 */

export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CopyNumber({ phone, blocked }: { phone: string; blocked: string | null }) {
  const [copied, setCopied] = React.useState(false);
  // Screening blocks the clipboard, not only a dial button — the same rule the
  // dialler applies. A prospect ringing us first does not lift it.
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

export function InboundList({
  calls,
  all,
  missed,
  readerTz,
  waiting = 0,
  showWho,
  mine = false,
  canFilterMine = false,
  myNumber = null,
}: {
  calls: InboundCall[];
  /** The clock this reader picked, used where the number that rang belongs to
   *  no place — a toll-free line. See `callbackZoneLabel`. */
  readerTz: string;
  all: boolean;
  /** Owed a ring back now — the same count as the badge. */
  missed: number;
  /** Owed one once it is morning where they are (`canWait`). Listed below, but
   *  not in `missed`, the badge or the work-order gate. */
  waiting?: number;
  /** Admins see whose number was rung; a caller only ever sees their own. */
  showWho: boolean;
  /** Showing only the calls that rang the reader's own number. */
  mine?: boolean;
  /** Whether to offer that at all. False for a caller, who only ever sees
   *  their own and would be given a filter that changes nothing. */
  canFilterMine?: boolean;
  /** The reader's own number, so the chip can name what "mine" means rather
   *  than leaving it to be assumed. Null when they have none. */
  myNumber?: string | null;
}) {
  const router = useRouter();
  // The ring back placed from a row's Call back button, so logging what came of
  // it joins the recording. Null when it was dialled from a handset.
  const { sessionFor } = useCallLine();
  const [busy, setBusy] = React.useState<number | null>(null);
  /**
   * The outcome picked for one row, before it is saved.
   *
   * Picked and confirmed in two steps, exactly as the dial card does it: one
   * tap next to another was the whole gesture there once, and a mis-tap became
   * a call in the record that had to be hunted down and corrected. Opening the
   * notes box is also what gives somebody somewhere to write "wants a quote
   * for a house clearance" before they forget it.
   */
  const [picked, setPicked] = React.useState<{
    id: number;
    outcome: CallOutcome;
    notes: string;
    callbackAt: string;
  } | null>(null);

  async function save(c: InboundCall, outcome: CallOutcome | null) {
    setBusy(c.id);
    try {
      const res = await fetch(`/api/inbound-calls/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          outcome === null
            ? {}
            : {
                outcome,
                notes: picked?.notes ?? "",
                callbackAt:
                  outcome === "callback" ? picked?.callbackAt : undefined,
                telnyxSessionId:
                  c.leadId !== null ? sessionFor(c.leadId)?.sessionId : undefined,
              },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that. Try again.");
        return;
      }
      const who = c.company ?? c.leadName ?? c.from;
      toast.success(
        outcome === null
          ? `Marked as rung back: ${who}`
          : `${OUTCOME_LABELS[outcome]}: ${who}`,
      );
      setPicked(null);
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">
          {missed > 0 ? (
            <>
              <span className="font-bold text-destructive">
                {missed} to ring back now
              </span>
              {!all && waiting === 0 && ", nothing else missed"}
            </>
          ) : waiting > 0 ? (
            "Nothing to ring back right now."
          ) : (
            "Nothing missed."
          )}
          {/* In the header as well as on each row, so a badge reading zero
              beside a list of missed calls does not look like a bug. */}
          {waiting > 0 && (
            <>
              {" "}
              <span className="font-semibold text-foreground">
                {waiting} can wait until they open
              </span>{" "}
              where they are.
            </>
          )}{" "}
          Last 30 days.
        </p>
        {/* Links rather than toggles so the state is in the URL and a refresh,
            a back button and a shared link all agree. Each keeps the other,
            or switching one would silently reset the other — the
            `call-filters.tsx` bug. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {canFilterMine && (
            <>
              <Link
                href={all ? "/missed-calls?show=all" : "/missed-calls"}
                aria-current={mine ? undefined : "page"}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                  mine
                    ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                    : "border-primary/40 bg-primary/10 text-primary",
                )}
              >
                Everyone
              </Link>
              <Link
                href={`/missed-calls?who=mine${all ? "&show=all" : ""}`}
                aria-current={mine ? "page" : undefined}
                title={myNumber ? `Calls to ${myNumber}` : undefined}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                  mine
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {/* Named by the thing it filters on. "Mine" alone would be
                    read as "calls I handled", which is a different list. */}
                To my number
              </Link>
            </>
          )}
          <Link
            href={
              all
                ? `/missed-calls${mine ? "?who=mine" : ""}`
                : `/missed-calls?show=all${mine ? "&who=mine" : ""}`
            }
            className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
          >
            {all ? "Missed only" : "Show every call"}
          </Link>
        </div>
      </div>

      {calls.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-8 text-center text-[13px] text-muted-foreground">
          {all
            ? "Nobody has rung in over the last 30 days."
            : "No missed calls. Anything that came in was answered."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {calls.map((c) => {
            const wasMissed = !c.answeredAt;
            const outstanding = wasMissed && !c.handledAt;
            return (
              <li
                key={c.id}
                className={cn(
                  "rounded-xl border px-4 py-3",
                  // Red only when it is owed now. One that can wait until their
                  // morning is still listed, but not shouting.
                  outstanding && !c.canWait
                    ? "border-destructive/40 bg-destructive/5"
                    : "bg-card",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[15px] font-bold">
                      {wasMissed ? (
                        <PhoneMissed
                          className="size-4 shrink-0 text-destructive"
                          strokeWidth={2.2}
                        />
                      ) : (
                        <PhoneIncoming
                          className="size-4 shrink-0 text-success"
                          strokeWidth={2.2}
                        />
                      )}
                      <span className="truncate">
                        {c.company ?? c.leadName ?? "Unknown caller"}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                      <span suppressHydrationWarning>{ago(c.at)}</span>
                      {c.answeredAt
                        ? ` · answered${c.seconds !== null ? `, ${mmss(c.seconds)}` : ""}`
                        : " · nobody picked up"}
                      {/* Said out loud rather than hidden by the roll-up: a
                          phone system redialling twenty times is worth
                          knowing about, and "rang 17 times" is the readable
                          version of seventeen identical rows. */}
                      {c.rings > 1 && ` · rang ${c.rings} times`}
                      {/* Which of our numbers they rang. Only an admin sees
                          more than one, so only an admin is told. */}
                      {showWho && c.forName && ` · for ${c.forName}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {c.listName && (
                      <Badge variant="outline" className="max-w-32">
                        <span className="min-w-0 truncate">{c.listName}</span>
                      </Badge>
                    )}
                    {/* Cleared with nobody named against it only happens to
                        calls restored after the fact — the ones lost while
                        inbound calls were failing to save, 4-15 September — and
                        none of those was ever rung back. */}
                    {c.handledAt &&
                      (c.handledBy ? (
                        <span className="text-[12px] font-semibold text-success">
                          Rung back by {c.handledBy}
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold text-muted-foreground">
                          Not rung back
                        </span>
                      ))}
                  </div>
                </div>

                {/* Why a missed call is not red and not in the badge. Their
                    clock is named so "can wait" is checkable, and it says the
                    list is not blocked, which is the part a caller acts on. */}
                {outstanding && c.canWait && (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      It&apos;s {c.theirNow} where they are, so this can wait.
                    </span>{" "}
                    They&apos;re closed now, so ring back once they open. It
                    isn&apos;t holding up your call list.
                  </p>
                )}

                {c.leadId === null && (
                  // Said out loud rather than left blank: a number we hold no
                  // lead for is the one most likely to be a real new enquiry.
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Not a lead in the CRM. It could still be one: business
                    owners often ring back from their own phone. When you ring
                    back,{" "}
                    <span className="font-semibold text-foreground">
                      ask which business they&apos;re with and their timezone
                    </span>
                    , and write both down.
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {/* From the number they rang, so the call comes from one
                      they already know. */}
                  {outstanding && (
                    <RingBackButton
                      to={c.from}
                      from={c.to}
                      leadId={c.leadId}
                      blocked={c.dncBlock}
                    />
                  )}
                  <CopyNumber phone={c.from} blocked={c.dncBlock} />
                  {outstanding &&
                    (c.leadId !== null ? (
                      // The same menu the dial card and the callbacks diary
                      // offer, because ringing somebody back is a call like
                      // any other and ends the same ways. "Rung back" on its
                      // own recorded that a finger had been lifted and nothing
                      // at all about what was said.
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={busy === c.id}
                          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          <PhoneOutgoing className="size-3.5" />
                          Log the call
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuLabel>
                            Attempt {c.attempts + 1}
                          </DropdownMenuLabel>
                          {CALL_TIME_OUTCOMES.map((o) => (
                            <DropdownMenuItem
                              key={o}
                              onSelect={() =>
                                setPicked({
                                  id: c.id,
                                  outcome: o,
                                  notes: "",
                                  callbackAt: defaultCallbackAt(c.tz, readerTz),
                                })
                              }
                            >
                              {OUTCOME_LABELS[o]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      // No lead behind the number, so there is nothing to log
                      // a call against — but it still has to be clearable, and
                      // a new enquiry from an unknown number is the row most
                      // worth not losing.
                      <button
                        type="button"
                        disabled={busy === c.id}
                        onClick={() => save(c, null)}
                        className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        Mark as rung back
                      </button>
                    ))}
                  {c.leadId !== null && c.listId !== null && (
                    // Into the dial card in its own niche, never the
                    // spreadsheet: the grid is a different tool with a
                    // different shape, and somebody sent there mid-shift has
                    // to work out where they have landed. `view=all` so the
                    // lead is present whatever state it is in, and `lead=`
                    // opens the card on it.
                    <Link
                      href={`/calls/${c.listId}?view=all&lead=${c.leadId}`}
                      className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
                    >
                      Open lead
                    </Link>
                  )}
                </div>

                {picked?.id === c.id && (
                  <div className="mt-3 rounded-lg border bg-background p-3">
                    <p className="text-[13px] font-bold">
                      {OUTCOME_LABELS[picked.outcome]}
                    </p>
                    <Textarea
                      value={picked.notes}
                      onChange={(e) =>
                        setPicked({ ...picked, notes: e.target.value })
                      }
                      placeholder="What did they say? (optional)"
                      className="mt-2 min-h-[64px]"
                    />
                    {picked.outcome === "callback" && (
                      <div className="mt-2 space-y-1.5">
                        <label
                          htmlFor={`cb-${c.id}`}
                          className="text-[12px] font-semibold"
                        >
                          {callbackZoneLabel(c.tz, readerTz)}
                        </label>
                        <Input
                          id={`cb-${c.id}`}
                          type="datetime-local"
                          value={picked.callbackAt}
                          onChange={(e) =>
                            setPicked({ ...picked, callbackAt: e.target.value })
                          }
                        />
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={busy === c.id}
                        onClick={() => save(c, picked.outcome)}
                      >
                        {busy === c.id ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === c.id}
                        onClick={() => setPicked(null)}
                      >
                        Cancel
                      </Button>
                      {/* Said where the decision is made: this is the one
                          control on the screen that does two things at once. */}
                      <span className="text-[12px] text-muted-foreground">
                        Saving also takes it off this list.
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
