"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";
import type { CallbackLead, CallOutcome } from "@/lib/calls";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
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

/** Callbacks are Singapore appointments, and the zone is pinned for the same
 *  reason the spreadsheet's is: the server renders in UTC and the browser in
 *  SGT, and left to themselves they disagree and React rebuilds the tree. */
const CALL_TZ = "Asia/Singapore";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CALL_TZ,
});

/**
 * How far off it is, in words.
 *
 * Overdue reads as "2h late" rather than "-2h": the number on its own does
 * not say which side of now it falls on, and this list is mostly read in a
 * hurry.
 */
function when(iso: string | null) {
  if (!iso) return { label: "No time set", overdue: false, soon: false };
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const abs = Math.abs(mins);
  const size =
    abs < 60
      ? `${abs}m`
      : abs < 60 * 24
        ? `${Math.round(abs / 60)}h`
        : `${Math.round(abs / 60 / 24)}d`;
  if (mins <= 0) return { label: `${size} late`, overdue: true, soon: true };
  return { label: `in ${size}`, overdue: false, soon: mins <= 60 };
}

function CopyNumber({ phone }: { phone: string }) {
  const [copied, setCopied] = React.useState(false);
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
          toast.error("Could not copy — select the number and copy it.");
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

export function CallbacksList({
  leads,
  demo = false,
}: {
  leads: CallbackLead[];
  demo?: boolean;
}) {
  const router = useRouter();
  // Rung and logged: dropped from the list at once, because the whole point of
  // this screen is that it empties as the afternoon goes on.
  const [logged, setLogged] = React.useState<Set<number>>(new Set());

  const rows = leads.filter((l) => !logged.has(l.id));

  async function log(lead: CallbackLead, outcome: CallOutcome) {
    const who = lead.company ?? lead.name ?? lead.phone;
    if (demo) {
      toast.success(`${OUTCOME_LABELS[outcome]} — demo, not saved`);
      setLogged((p) => new Set(p).add(lead.id));
      return;
    }
    setLogged((p) => new Set(p).add(lead.id));
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLeadId: lead.id, outcome }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not log the call.");
        setLogged((p) => {
          const next = new Set(p);
          next.delete(lead.id);
          return next;
        });
        return;
      }
      toast.success(
        `${OUTCOME_LABELS[outcome]} — ${who}, attempt ${lead.attempts + 1}`,
      );
      router.refresh();
    } catch {
      toast.error("Could not log the call — network error.");
      setLogged((p) => {
        const next = new Set(p);
        next.delete(lead.id);
        return next;
      });
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center">
        <p className="text-sm font-semibold">
          {leads.length === 0 ? "No callbacks owed." : "All caught up."}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {leads.length === 0
            ? 'They appear here when a call is logged as "Call back".'
            : "Every callback on this list has been worked."}
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((l) => {
        const due = when(l.callbackAt);
        return (
          <li
            key={l.id}
            data-lead-id={l.id}
            className={cn(
              "rounded-xl border bg-card p-3.5 sm:p-4",
              // The server's answer, so the border cannot differ between the
              // HTML and the hydration.
              l.due && "border-destructive/40",
            )}
          >
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                {/* Wraps rather than truncating: "ELITE SPINE CE…" does not
                    tell you who you are about to ring. */}
                <p className="font-bold tracking-[-0.01em]">
                  {l.company ?? l.name ?? l.phone}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[l.name, l.title].filter(Boolean).join(" · ") ||
                    "No contact name"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/* The label counts down live, so it can cross a boundary
                    between render and hydration — same note as the board. */}
                <Badge
                  suppressHydrationWarning
                  variant={l.due ? "destructive" : "secondary"}
                >
                  {due.label}
                </Badge>
                <Badge variant="outline" className="max-w-32">
                  <span className="min-w-0 truncate">{l.listName}</span>
                </Badge>
              </div>
            </div>

            {/* The time they asked for, spelled out — "in 3h" is what you act
                on, the date is what you check it against. */}
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {l.callbackAt
                ? timeFormat.format(new Date(l.callbackAt))
                : "No time was set on this callback"}
              {l.attempts > 0 &&
                ` · ${l.attempts} ${l.attempts === 1 ? "try" : "tries"}`}
            </p>

            {l.lastNotes && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                {l.lastNotes}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CopyNumber phone={l.phone} />
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted">
                  <PhoneOutgoing className="size-3.5" />
                  Log the call
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Attempt {l.attempts + 1}</DropdownMenuLabel>
                  {(Object.keys(OUTCOME_LABELS) as CallOutcome[]).map((o) => (
                    <DropdownMenuItem key={o} onSelect={() => log(l, o)}>
                      {OUTCOME_LABELS[o]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {l.email && (
                <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                  {l.email}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
