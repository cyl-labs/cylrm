"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Clock, PhoneForwarded, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CallBackButton } from "@/components/calls/call-back-button";
import { CopyNumber } from "@/components/calls/inbound-list";
import { MeetingCallButton } from "@/components/calls/meeting-call-button";
import type { SavedLine } from "@/components/calls/second-line";
import {
  callbackZoneLabel,
  defaultCallbackAt,
  theirClock,
} from "@/lib/call-time";
import { e164 } from "@/lib/phone";
import type { FounderCall } from "@/lib/founder-calls";
import { cn } from "@/lib/utils";

/**
 * A call a founder puts on the Meetings calendar for themselves (2026-09-24).
 *
 * Not a callback — those are the floor's work order, and land in a caller's
 * queue — and not a reschedule, which emails the prospect. Founders only, and
 * nothing here is ever sent anywhere. See `lib/founder-calls.ts`.
 */

/** An instant as the wall clock a `datetime-local` box shows, in `tz`. */
function wallClockOf(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "Thu, Sep 25, 10:00 AM", on the reader's clock. */
function when(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(iso));
}

/**
 * Change a call back already on the calendar: its time, or its notes.
 *
 * Said in the description that nothing reaches the prospect, because "Move
 * this demo" on the Meetings rows does email them, and this must not be
 * mistaken for it.
 */
function FounderCallDialog({
  onOpenChange,
  name,
  theirTz,
  readerTz,
  existing,
}: {
  onOpenChange: (open: boolean) => void;
  name: string;
  theirTz: string | null;
  readerTz: string;
  existing: { id: number; startAt: string; notes: string | null };
}) {
  const router = useRouter();
  const zone = theirTz ?? readerTz;
  const [at, setAt] = React.useState(() => wallClockOf(existing.startAt, zone));
  const [notes, setNotes] = React.useState(existing.notes ?? "");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (saving || !at) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/founder-calls/${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at, notes }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that. Try again.");
        return;
      }
      toast.success(`Call back moved: ${name}`);
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your call back: {name}</DialogTitle>
          <DialogDescription>
            This only moves it on your calendar. Nothing is sent to them, and
            your callers will not see it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="founder-call-at">
              {callbackZoneLabel(theirTz, readerTz)}
            </Label>
            <Input
              id="founder-call-at"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="founder-call-notes">Notes (optional)</Label>
            <Textarea
              id="founder-call-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What to ring them about"
              className="min-h-[64px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !at}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * After a founder marks a demo **No show** (2026-09-24): when to call them
 * back, or that they are dead.
 *
 * Asked for in place of a separate call-back button — "for all no shows I'll
 * basically follow up no matter what" — so the decision is asked at the one
 * moment it is always made. Either answer settles the no-show for everybody:
 *
 * - **A time** puts a founders' call back on the calendar (`founder_call`),
 *   which takes the ring back off the Meetings list. Nothing is sent to them.
 * - **Dead** logs the ring back as "Not rebooking" through the same route the
 *   ring-back logger uses, so it is recorded the way it always has been.
 *
 * "Decide later" closes it and leaves the no-show on the founders' list.
 */
export function NoShowDialog({
  meetingId,
  name,
  theirTz,
  readerTz,
  onClose,
}: {
  meetingId: number;
  name: string;
  theirTz: string | null;
  readerTz: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [at, setAt] = React.useState(() => defaultCallbackAt(theirTz, readerTz));
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState<null | "call" | "dead">(null);

  async function callBack() {
    if (saving || !at) return;
    setSaving("call");
    try {
      const res = await fetch("/api/founder-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, at, notes }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that. Try again.");
        return;
      }
      toast.success(`On your calendar: call back ${name}`);
      onClose();
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setSaving(null);
    }
  }

  async function dead() {
    if (saving) return;
    setSaving("dead");
    try {
      const res = await fetch(`/api/meetings/${meetingId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: "cancelled",
          notes: notes.trim() || "Dead after the no-show: not following up.",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that. Try again.");
        return;
      }
      toast.success(`Off your list: ${name}`);
      onClose();
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name} did not turn up</DialogTitle>
          <DialogDescription>
            When do you want to call them back? It goes on your calendar. Only
            founders see it, and nothing is sent to them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="no-show-at">{callbackZoneLabel(theirTz, readerTz)}</Label>
            <Input
              id="no-show-at"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="no-show-notes">Notes (optional)</Label>
            <Textarea
              id="no-show-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember when you ring"
              className="min-h-[56px]"
            />
          </div>
          <Button
            className="h-11 w-full text-[15px]"
            onClick={() => void callBack()}
            disabled={saving !== null || !at}
          >
            <PhoneForwarded data-icon="inline-start" />
            {saving === "call" ? "Saving…" : "Put it on my calendar"}
          </Button>
        </div>
        <div className="mt-1 border-t pt-3">
          <p className="mb-2 text-[12px] text-muted-foreground">
            Or, if you have tried enough and they are not worth another call:
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:text-destructive"
              onClick={() => void dead()}
              disabled={saving !== null}
            >
              {saving === "dead" ? "Saving…" : "Dead — take them off my list"}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={saving !== null}>
              Decide later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Your call backs": every open one, above the meetings, with what is needed
 * to make the call and to say it is done.
 */
export function FounderCallList({
  calls,
  tz,
  zoneLabel,
  dialFrom,
  lines,
}: {
  calls: FounderCall[];
  tz: string;
  zoneLabel: string;
  /** The founder's own number, which the call goes out from. */
  dialFrom: string | null;
  lines: SavedLine[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<number | null>(null);
  const [editing, setEditing] = React.useState<FounderCall | null>(null);

  if (calls.length === 0) return null;

  async function act(c: FounderCall, how: "done" | "remove") {
    if (how === "remove" && !window.confirm(`Remove the call back to ${c.name}?`)) {
      return;
    }
    setBusy(c.id);
    try {
      const res = await fetch(`/api/founder-calls/${c.id}`, {
        method: how === "done" ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: how === "done" ? JSON.stringify({ done: true }) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that. Try again.");
        return;
      }
      toast.success(how === "done" ? `Done: ${c.name}` : `Removed: ${c.name}`);
      router.refresh();
    } catch {
      toast.error("Could not save that: network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="founder-calls-heading" className="flex flex-col gap-2">
      <div>
        <h2 id="founder-calls-heading" className="text-[15px] font-bold">
          Your call backs
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Calls the founders are making themselves. Only founders see these,
          and nothing is sent to the prospect. Times are {zoneLabel} time.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {calls.map((c) => {
          const their = theirClock(new Date(c.startAt), c.theirTz, tz);
          const to = c.phone ? (e164(c.phone) ?? c.phone) : null;
          return (
            <li
              key={c.id}
              // The calendar's chips link here.
              id={`call-back-${c.id}`}
              className={cn(
                "scroll-mt-4 rounded-xl border px-4 py-3",
                c.due ? "border-amber-500/50 bg-amber-500/5" : "bg-card",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[15px] font-bold">
                    <PhoneForwarded className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="truncate">{c.name}</span>
                  </p>
                  <p className="mt-0.5 text-[13px]">
                    <span className="font-semibold" suppressHydrationWarning>
                      {when(c.startAt, tz)}
                    </span>
                    {their && (
                      <span className="text-muted-foreground">
                        {" · "}
                        {their} their time
                      </span>
                    )}
                  </p>
                </div>
                {c.due && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] text-amber-800 dark:text-amber-300">
                    Due now
                  </span>
                )}
              </div>
              {c.notes && (
                <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">
                  {c.notes}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <MeetingCallButton
                  who={c.name}
                  to={to}
                  from={dialFrom}
                  leadId={c.leadId}
                  rowKey={`founder-call:${c.id}`}
                  blocked={c.dncBlock}
                  label="Call them"
                  lines={lines}
                />
                {c.listId !== null && c.leadId !== null && !c.dncBlock && (
                  <CallBackButton
                    listId={c.listId}
                    leadId={c.leadId}
                    label="Open lead"
                    className="bg-transparent text-foreground border hover:bg-muted"
                  />
                )}
                {c.phone && <CopyNumber phone={c.phone} blocked={c.dncBlock} />}
                <button
                  type="button"
                  disabled={busy === c.id}
                  onClick={() => void act(c, "done")}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Check className="size-3.5" />
                  Done
                </button>
                <button
                  type="button"
                  disabled={busy === c.id}
                  onClick={() => setEditing(c)}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Clock className="size-3.5" />
                  Change time
                </button>
                <button
                  type="button"
                  disabled={busy === c.id}
                  onClick={() => void act(c, "remove")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <FounderCallDialog
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          name={editing.name}
          theirTz={editing.theirTz}
          readerTz={tz}
          existing={{ id: editing.id, startAt: editing.startAt, notes: editing.notes }}
        />
      )}
    </section>
  );
}
