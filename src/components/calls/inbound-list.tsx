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
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dialableNumber } from "@/lib/phone";
import type { InboundCall } from "@/lib/inbound";
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

  async function markHandled(c: InboundCall) {
    setBusy(c.id);
    try {
      const res = await fetch(`/api/inbound-calls/${c.id}`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      toast.success(`Marked as rung back: ${c.company ?? c.from}`);
      router.refresh();
    } catch {
      toast.error("Could not save that. Try again.");
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
                  {outstanding && (
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => markHandled(c)}
                      className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      Mark as rung back
                    </button>
                  )}
                  {c.leadId !== null && (
                    <Link
                      href={`/call-sheet?lead=${c.leadId}`}
                      className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
                    >
                      Open lead
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
