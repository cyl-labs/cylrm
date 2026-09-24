"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PhoneForwarded } from "lucide-react";
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
import { wallClockIn } from "@/lib/call-time";
import { cn } from "@/lib/utils";

/**
 * When to call a no-show back — the one prompt behind every founders' call
 * back (2026-09-24).
 *
 * A no-show's meeting is moved to the time picked here as a **call back**:
 * the row and its calendar chip sit at the new time, and the founder logs the
 * meeting's ring back on it when they ring. It is never a Cal.com reschedule,
 * so the prospect hears nothing. See `founder_call` and `lib/meetings.ts`.
 *
 * Four ways in, one form:
 *
 * - `no_show` — straight after "No show" is saved. Also offers Dead, and
 *   Decide later.
 * - `no_answer` — "No answer, try again" on a call back: the next try.
 * - `spoke` — "Spoke to them, rebooking later": when to ring next.
 * - `move` — "Change time", nothing logged.
 *
 * **Intervals first, tomorrow picked** — asked for as "let me choose the
 * intervals, make it tomorrow by default, but let me change it to a specific
 * day as well". Each interval keeps the time of day the meeting was at (the
 * demo, or the call back before), in the prospect's zone: a slot they once
 * agreed to is the best guess at when they pick up. "Pick a day" opens a date
 * and a time.
 */

export type CallBackMode = "no_show" | "no_answer" | "spoke" | "move";

const INTERVALS = [
  { days: 1, label: "Tomorrow" },
  { days: 2, label: "In 2 days" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In a week" },
] as const;

/** An instant as the wall clock a date or time box shows, in `tz`. */
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

/** Their calendar date, `n` days on. Plain date arithmetic on the day, so no
 *  hour is ever added across a daylight-saving change. */
function dayIn(tz: string, n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const [y, mo, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

const TITLES: Record<CallBackMode, (name: string) => string> = {
  no_show: (name) => `${name} did not turn up`,
  no_answer: (name) => `No answer from ${name}`,
  spoke: (name) => `When do you ring ${name} next?`,
  move: (name) => `Move the call back with ${name}`,
};

const EXPLAINED: Record<CallBackMode, string> = {
  no_show:
    "When do you want to call them back? The meeting moves to that time as a call back. Only founders see it, and nothing is sent to them.",
  no_answer:
    "When do you want to try again? The call back moves to that time. Nothing is sent to them.",
  spoke:
    "You spoke to them but have no new time yet. The call back moves to when you will ring next.",
  move: "This only moves the call back on your calendar. Nothing is sent to them.",
};

export function CallBackPrompt({
  mode,
  meetingId,
  callBackId,
  name,
  theirTz,
  readerTz,
  anchorAt,
  onClose,
}: {
  mode: CallBackMode;
  meetingId: number;
  /** The open call back, for every mode but `no_show`, which creates it. */
  callBackId?: number;
  name: string;
  theirTz: string | null;
  readerTz: string;
  /** Whose time of day the intervals keep: the demo's, or the call back's. */
  anchorAt: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const zone = theirTz ?? readerTz;
  const timeOfDay = wallClockOf(anchorAt, zone).slice(11, 16);
  const [choice, setChoice] = React.useState<number | "pick">(1);
  const [pickDate, setPickDate] = React.useState(() => dayIn(zone, 1));
  const [pickTime, setPickTime] = React.useState(timeOfDay);
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState<null | "save" | "dead">(null);

  const wall =
    choice === "pick" ? `${pickDate}T${pickTime}` : `${dayIn(zone, choice)}T${timeOfDay}`;
  const at = wallClockIn(wall, zone);
  const fmt = (tz: string) =>
    at
      ? new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: tz,
        }).format(at)
      : "";
  const theirs = fmt(zone);
  const yours = fmt(readerTz);

  async function save() {
    if (saving || !at) return;
    setSaving("save");
    try {
      const res =
        mode === "no_show"
          ? await fetch("/api/founder-calls", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ meetingId, at: wall, notes }),
            })
          : await fetch(`/api/founder-calls/${callBackId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                mode === "move"
                  ? { at: wall, ...(notes.trim() ? { notes } : {}) }
                  : {
                      result: mode === "no_answer" ? "no_answer" : "confirmed",
                      at: wall,
                      notes,
                    },
              ),
            });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that. Try again.");
        return;
      }
      toast.success(`Call back ${name}: ${theirs}${theirTz ? " their time" : ""}`);
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

  const chip = (active: boolean) =>
    cn(
      "rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors",
      active
        ? "border-primary/40 bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[mode](name)}</DialogTitle>
          <DialogDescription>{EXPLAINED[mode]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div role="group" aria-label="When" className="flex flex-wrap gap-1.5">
            {INTERVALS.map((i) => (
              <button
                key={i.days}
                type="button"
                aria-pressed={choice === i.days}
                onClick={() => setChoice(i.days)}
                className={chip(choice === i.days)}
              >
                {i.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={choice === "pick"}
              onClick={() => {
                // Opens on whatever was picked, so switching is a tweak rather
                // than starting again.
                if (choice !== "pick") setPickDate(dayIn(zone, choice));
                setChoice("pick");
              }}
              className={chip(choice === "pick")}
            >
              Pick a day
            </button>
          </div>

          {choice === "pick" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="call-back-day">Day</Label>
                <Input
                  id="call-back-day"
                  type="date"
                  min={dayIn(zone, 0)}
                  value={pickDate}
                  onChange={(e) => setPickDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="call-back-time">
                  Time ({theirTz ? "their time" : "your clock"})
                </Label>
                <Input
                  id="call-back-time"
                  type="time"
                  value={pickTime}
                  onChange={(e) => setPickTime(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* The answer, in both clocks, before anything is saved. */}
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
            {at ? (
              <>
                <span className="font-semibold">{theirs}</span>
                {theirTz ? " their time" : " your time"}
                {theirTz && yours !== theirs && (
                  <span className="text-muted-foreground"> · {yours} yours</span>
                )}
                {!theirTz && (
                  <span className="text-muted-foreground">
                    {" "}
                    · no timezone known for this number
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Pick a day and a time.</span>
            )}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="call-back-notes">
              {mode === "move" ? "Note on the call back (optional)" : "Notes (optional)"}
            </Label>
            <Textarea
              id="call-back-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                mode === "no_answer"
                  ? "Left a voicemail? Anything to try next time"
                  : "Anything to remember when you ring"
              }
              className="min-h-[56px]"
            />
          </div>
        </div>

        {mode === "no_show" ? (
          <>
            <Button
              className="h-11 w-full text-[15px]"
              onClick={() => void save()}
              disabled={saving !== null || !at}
            >
              <PhoneForwarded data-icon="inline-start" />
              {saving === "save" ? "Saving…" : "Move it to a call back"}
            </Button>
            <div className="border-t pt-3">
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
          </>
        ) : (
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={saving !== null}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving !== null || !at}>
              {saving === "save" ? "Saving…" : "Move the call back"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
