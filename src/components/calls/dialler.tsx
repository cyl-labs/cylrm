"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, SkipForward, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { CallOutcome, QueueLead } from "@/lib/calls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  gatekeeper: "Gatekeeper",
  callback: "Call back",
  not_interested: "Not interested",
  interested: "Interested",
  demo_booked: "Demo booked",
  bad_number: "Bad number",
};

/** Left column keeps the lead in the queue, right column closes it out. */
const KEEP: CallOutcome[] = ["no_answer", "voicemail", "gatekeeper", "callback"];
const CLOSE: CallOutcome[] = [
  "interested",
  "demo_booked",
  "not_interested",
  "bad_number",
];

export function outcomeTone(outcome: CallOutcome) {
  if (outcome === "interested" || outcome === "demo_booked") return "default";
  if (outcome === "not_interested" || outcome === "bad_number") {
    return "destructive";
  }
  return "secondary";
}

/**
 * The number, as a button that copies it.
 *
 * Calls are placed from a separate handset or softphone, so handing the number
 * to the clipboard beats a `tel:` link that would try to dial from whatever
 * device the browser happens to be on.
 *
 * Mounted with `key={lead.id}` at the call site so "Copied" cannot linger from
 * the previous number.
 */
function CopyNumber({ phone }: { phone: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone.trim());
      setCopied(true);
      // Long enough to register, short enough that the next tap reads as new.
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select the number and copy it manually.");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${phone}`}
      className={cn(
        "mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-xl text-lg font-extrabold tracking-[-0.01em] transition-colors",
        copied
          ? "bg-success text-primary-foreground"
          : "bg-primary text-primary-foreground hover:bg-primary/80",
      )}
    >
      {copied ? (
        <Check className="size-5" strokeWidth={2.4} />
      ) : (
        <Copy className="size-5" strokeWidth={2.2} />
      )}
      {copied ? "Copied" : phone}
    </button>
  );
}

function defaultCallbackAt() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  // datetime-local wants local time with no zone suffix.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relative(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Outcome buttons, notes and the callback picker for one lead.
 *
 * Mounted with `key={lead.id}` so each new number starts clean — see the call
 * site. Everything it owns is scoped to the lead in front of you.
 */
function CallForm({
  lead,
  onLogged,
  onSkip,
}: {
  lead: QueueLead;
  onLogged: () => void;
  onSkip: () => void;
}) {
  const [notes, setNotes] = React.useState("");
  const [callbackAt, setCallbackAt] = React.useState(defaultCallbackAt);
  const [showCallback, setShowCallback] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function log(outcome: CallOutcome) {
    if (saving) return;
    // First tap on "Call back" opens the picker, second one saves — the time
    // is the whole point of that outcome, so it should not default silently.
    if (outcome === "callback" && !showCallback) {
      setShowCallback(true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLeadId: lead.id,
          outcome,
          notes,
          callbackAt: outcome === "callback" ? callbackAt : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Could not save (${res.status}).`);
        return;
      }
      toast.success(
        `${OUTCOME_LABELS[outcome]} — ${lead.company ?? lead.phone}`,
      );
      onLogged();
    } catch {
      toast.error("Could not save — network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes from the call…"
        className="mt-4 min-h-[64px]"
      />

      {showCallback && (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="callback-at">Call back at</Label>
          <Input
            id="callback-at"
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Tap “Call back” again to save.
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Didn&rsquo;t connect
          </p>
          {KEEP.map((o) => (
            <Button
              key={o}
              variant={o === "callback" && showCallback ? "default" : "outline"}
              className="w-full justify-start"
              disabled={saving}
              onClick={() => log(o)}
            >
              {OUTCOME_LABELS[o]}
            </Button>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Done with them
          </p>
          {CLOSE.map((o) => (
            <Button
              key={o}
              variant={
                o === "interested" || o === "demo_booked"
                  ? "default"
                  : "destructive"
              }
              className="w-full justify-start"
              disabled={saving}
              onClick={() => log(o)}
            >
              {OUTCOME_LABELS[o]}
            </Button>
          ))}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full"
        disabled={saving}
        onClick={onSkip}
      >
        <SkipForward data-icon="inline-start" />
        Skip without logging
      </Button>
    </>
  );
}

export function Dialler({
  leads,
  readOnly = false,
}: {
  leads: QueueLead[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  // Worked leads drop out of the local queue immediately so the next number is
  // always one tap away; the server list refreshes underneath.
  const [done, setDone] = React.useState<Set<number>>(new Set());
  const [skipped, setSkipped] = React.useState<number[]>([]);

  const remaining = React.useMemo(
    () => leads.filter((l) => !done.has(l.id) && !skipped.includes(l.id)),
    [leads, done, skipped],
  );
  const current = remaining[0] ?? null;
  const upNext = remaining.slice(1, 6);

  function handleLogged(leadId: number) {
    setDone((prev) => new Set(prev).add(leadId));
    router.refresh();
  }

  if (!current) {
    return (
      <div className="px-4 py-16 text-center sm:px-6">
        <p className="text-sm font-semibold">
          {leads.length === 0 ? "Nothing to call here." : "Queue cleared."}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {leads.length === 0
            ? "Import a CSV with a phone column to start."
            : "Every lead in this view has been worked."}
        </p>
        {skipped.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setSkipped([])}
          >
            <Undo2 data-icon="inline-start" />
            Bring back {skipped.length} skipped
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold tracking-[-0.01em]">
              {current.company ?? current.name ?? current.phone}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              {[current.name, current.title].filter(Boolean).join(" · ") ||
                "No contact name"}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {current.attempts > 0 && (
              <Badge variant="secondary">
                {current.attempts} {current.attempts === 1 ? "try" : "tries"}
              </Badge>
            )}
            <Badge variant="outline">{remaining.length} left</Badge>
          </div>
        </div>

        {current.lastOutcome && (
          <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
            <span className="font-semibold">
              Last: {OUTCOME_LABELS[current.lastOutcome]}
            </span>
            {current.lastCalledAt && (
              <span className="text-muted-foreground">
                {" "}
                · {relative(current.lastCalledAt)}
              </span>
            )}
            {current.lastNotes && (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {current.lastNotes}
              </p>
            )}
          </div>
        )}

        <CopyNumber key={current.id} phone={current.phone} />
        {current.email && (
          <p className="mt-2 truncate text-center text-xs text-muted-foreground">
            {current.email}
          </p>
        )}

        {!readOnly && (
          // Keyed on the lead so moving to the next number remounts the form:
          // notes and the callback picker reset by construction rather than by
          // an effect that clears them after the fact.
          <CallForm
            key={current.id}
            lead={current}
            onLogged={() => handleLogged(current.id)}
            onSkip={() => setSkipped((prev) => [...prev, current.id])}
          />
        )}
      </div>

      {upNext.length > 0 && (
        <div className="mt-5">
          <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            Up next
          </p>
          <ul className="divide-y rounded-xl border bg-card">
            {upNext.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {l.company ?? l.name ?? l.phone}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {l.phone}
                </span>
                {l.lastOutcome && (
                  <Badge
                    variant={outcomeTone(l.lastOutcome)}
                    className={cn("shrink-0")}
                  >
                    {OUTCOME_LABELS[l.lastOutcome]}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
