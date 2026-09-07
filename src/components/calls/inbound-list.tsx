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
import { callTzDate } from "@/lib/call-time";
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

function ago(iso: string): string {
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

/** Ten tomorrow morning, Singapore time — the same default the dial card
 *  offers, so a callback set from here lands where one set there would. */
function defaultCallbackAt(): string {
  const sgToday = new Date(`${callTzDate()}T00:00:00Z`);
  sgToday.setUTCDate(sgToday.getUTCDate() + 1);
  return `${sgToday.toISOString().slice(0, 10)}T10:00`;
}

function CopyNumber({ phone, blocked }: { phone: string; blocked: string | null }) {
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
  showWho,
}: {
  calls: InboundCall[];
  all: boolean;
  missed: number;
  /** Admins see whose number was rung; a caller only ever sees their own. */
  showWho: boolean;
}) {
  const router = useRouter();
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
                {missed} to ring back
              </span>
              {!all && ", nothing else missed"}
            </>
          ) : (
            "Nothing missed."
          )}{" "}
          Last 30 days.
        </p>
        {/* A link rather than a toggle so the state is in the URL and a
            refresh, a back button and a shared link all agree. */}
        <Link
          href={all ? "/missed-calls" : "/missed-calls?show=all"}
          className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
        >
          {all ? "Missed only" : "Show every call"}
        </Link>
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
                  outstanding ? "border-destructive/40 bg-destructive/5" : "bg-card",
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
                    {c.handledAt && (
                      <span className="text-[12px] font-semibold text-success">
                        Rung back
                        {c.handledBy ? ` by ${c.handledBy}` : ""}
                      </span>
                    )}
                  </div>
                </div>

                {c.leadId === null && (
                  // Said out loud rather than left blank: a number we hold no
                  // lead for is the one most likely to be a real new enquiry.
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Not a lead in the CRM.
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
                                  callbackAt: defaultCallbackAt(),
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
                          Call back at (Singapore time)
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
