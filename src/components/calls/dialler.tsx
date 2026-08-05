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
import { OUTCOME_LABELS, outcomeTone } from "@/components/calls/outcome";
import { dialableNumber } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * Left column keeps the lead in the queue, right column closes it out.
 *
 * Only the outcomes a cold call can actually end in. Trial, won and lost come
 * days or weeks later and are set from the board or the spreadsheet — putting
 * them here would mean six buttons on a phone for things that never happen
 * while the phone is at your ear.
 */
const KEEP: CallOutcome[] = ["no_answer", "voicemail", "gatekeeper", "callback"];
const CLOSE: CallOutcome[] = ["demo_booked", "not_interested", "bad_number"];

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
      // The country code is stripped: this is pasted into a Singapore keypad.
      await navigator.clipboard.writeText(dialableNumber(phone));
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
  demo = false,
  onLogged,
  onSkip,
}: {
  lead: QueueLead;
  /** Demo workspace: run the flow, save nothing. */
  demo?: boolean;
  onLogged: () => void;
  onSkip: () => void;
}) {
  const [notes, setNotes] = React.useState("");
  const [callbackAt, setCallbackAt] = React.useState(defaultCallbackAt);
  // Picked but not yet saved. Nothing is written until the confirm button is
  // pressed: one tap next to another used to be the whole gesture, and a
  // mis-tap became a call in the record that had to be found and corrected
  // later.
  const [picked, setPicked] = React.useState<CallOutcome | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    const outcome = picked;
    if (!outcome || saving) return;
    // The demo advances the queue locally rather than hiding these buttons:
    // a dialler whose outcome buttons are missing does not demonstrate a
    // dialler. Nothing is written, and the toast says so.
    if (demo) {
      toast.success(`${OUTCOME_LABELS[outcome]} — demo, not saved`);
      onLogged();
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

      {picked === "callback" && (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="callback-at">Call back at</Label>
          <Input
            id="callback-at"
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
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
              variant={picked === o ? "default" : "outline"}
              className="w-full justify-start"
              disabled={saving}
              onClick={() => setPicked(picked === o ? null : o)}
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
              // Picked reads as filled, unpicked as the outline of what it
              // would become, so the two columns still read differently.
              variant={
                picked === o
                  ? o === "demo_booked"
                    ? "default"
                    : "destructive"
                  : "outline"
              }
              className={cn(
                "w-full justify-start",
                picked !== o &&
                  o !== "demo_booked" &&
                  "border-destructive/40 text-destructive hover:text-destructive",
              )}
              disabled={saving}
              onClick={() => setPicked(picked === o ? null : o)}
            >
              {OUTCOME_LABELS[o]}
            </Button>
          ))}
        </div>
      </div>

      {/* Nothing is written until this is pressed. Tapping an outcome only
          selects it, so a mis-tap is undone by tapping another — or the same
          one again — rather than by correcting a logged call afterwards. */}
      <Button
        className="mt-4 h-12 w-full text-[15px]"
        disabled={!picked || saving}
        onClick={save}
      >
        <Check data-icon="inline-start" />
        {saving
          ? "Saving…"
          : picked
            ? `Log ${OUTCOME_LABELS[picked].toLowerCase()}`
            : "Pick an outcome to log"}
      </Button>

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
  truncated = false,
  readOnly = false,
  demo = false,
}: {
  leads: QueueLead[];
  /** More leads match this view than were loaded — said out loud, because a
   *  tab labelled "All" showing part of a list is a lie. */
  truncated?: boolean;
  /** Closed view: these calls are finished, there is nothing to log. */
  readOnly?: boolean;
  /** Demo workspace: the flow works, nothing is written. */
  demo?: boolean;
}) {
  const router = useRouter();
  // Worked leads drop out of the local queue immediately so the next number is
  // always one tap away; the server list refreshes underneath.
  const [done, setDone] = React.useState<Set<number>>(new Set());
  const [skipped, setSkipped] = React.useState<number[]>([]);

  // A lead picked out of the list below jumps the queue. Cleared as soon as it
  // is worked, so the order resumes where it was.
  const [pickedId, setPickedId] = React.useState<number | null>(null);

  const remaining = React.useMemo(
    () => leads.filter((l) => !done.has(l.id) && !skipped.includes(l.id)),
    [leads, done, skipped],
  );
  const current =
    remaining.find((l) => l.id === pickedId) ?? remaining[0] ?? null;
  // Every lead still to work, not the first handful: "All" that showed six of
  // forty was the complaint, and a queue you cannot see the end of is worse
  // than a long list.
  const upNext = remaining.filter((l) => l.id !== current?.id);

  function handleLogged(leadId: number) {
    setDone((prev) => new Set(prev).add(leadId));
    setPickedId(null);
    // Nothing was written in the demo, so refetching would only put the lead
    // straight back and make the queue look stuck.
    if (!demo) router.refresh();
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
              // Clock-derived, so server and client can disagree by a minute
              // across a rounding boundary — see the board for the same note.
              <span suppressHydrationWarning className="text-muted-foreground">
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

        {/* Keys are prefixed because this and CallForm below are siblings:
            keying both on the bare lead id gave one parent two children with
            the same key, which React is entitled to conflate. */}
        <CopyNumber key={`number-${current.id}`} phone={current.phone} />
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
            key={`form-${current.id}`}
            lead={current}
            demo={demo}
            onLogged={() => handleLogged(current.id)}
            onSkip={() => {
              setSkipped((prev) => [...prev, current.id]);
              setPickedId(null);
            }}
          />
        )}
      </div>

      {upNext.length > 0 && (
        <div className="mt-5">
          <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            Up next
            <span className="ml-1.5 tabular-nums opacity-70">
              {upNext.length}
            </span>
          </p>
          <ul className="divide-y rounded-xl border bg-card">
            {upNext.map((l) => (
              <li key={l.id}>
                {/* Tapping a row dials that one next. Without it the only way
                    to reach the fortieth lead was to skip thirty-nine. */}
                <button
                  type="button"
                  onClick={() => {
                    setPickedId(l.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-muted/50"
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
                </button>
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="px-1 pt-2 text-[12px] text-muted-foreground">
              Showing the first {leads.length.toLocaleString()} of this view.
              The spreadsheet holds the rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
