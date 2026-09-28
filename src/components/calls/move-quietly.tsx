"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { wallClockIn } from "@/lib/call-time";

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

const say = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);

/**
 * Move a meeting on our calendar only (2026-09-28): no Cal.com, no email, no
 * no-show to mark first. The card, our reminders and "did they turn up" all
 * move to the new time; see `/api/meetings/[id]/time`.
 *
 * Opens on the meeting's current time in the prospect's clock, so a small
 * shift is a small edit. It says plainly that Cal.com keeps the old time and
 * will send its own reminder for it, since that email is the one thing this
 * cannot stop and the prospect is the one who reads it.
 */
export function MoveQuietly({
  meetingId,
  name,
  theirTz,
  readerTz,
  startAt,
  calStartAt,
  onClose,
}: {
  meetingId: number;
  name: string;
  theirTz: string | null;
  readerTz: string;
  startAt: string;
  /** Cal.com's time, when it already differs from ours. */
  calStartAt: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const zone = theirTz ?? readerTz;
  const initial = wallClockOf(startAt, zone);
  const [day, setDay] = React.useState(initial.slice(0, 10));
  const [time, setTime] = React.useState(initial.slice(11, 16));
  const [saving, setSaving] = React.useState(false);

  const wall = `${day}T${time}`;
  const at = day && time ? wallClockIn(wall, zone) : null;
  const unchanged = at !== null && at.getTime() === new Date(startAt).getTime();
  const calTime = new Date(calStartAt ?? startAt);

  async function save() {
    if (saving || !at || unchanged) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/time`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: wall }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not move it. Try again.");
        return;
      }
      toast.success(`${name} moved to ${say(at, zone)}${theirTz ? " their time" : ""}`, {
        description: "Nothing was sent to them.",
      });
      onClose();
      router.refresh();
    } catch {
      toast.error("Could not move it: network error.");
    } finally {
      setSaving(false);
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
          <DialogTitle>Move {name} quietly</DialogTitle>
          <DialogDescription>
            Moves it in the CRM only. The card, your reminders and &ldquo;did
            they turn up&rdquo; all follow the new time. Nothing is sent to
            them, so tell them the new time yourself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="move-day">Day</Label>
              <Input
                id="move-day"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="move-time">
                Time ({theirTz ? "their time" : "your clock"})
              </Label>
              <Input
                id="move-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          {/* The answer in both clocks before anything is saved. */}
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
            {at ? (
              <>
                <span className="font-semibold">{say(at, zone)}</span>
                {theirTz ? " their time" : " your time"}
                {theirTz && say(at, readerTz) !== say(at, zone) && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {say(at, readerTz)} yours
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Pick a day and a time.</span>
            )}
          </p>

          <p className="text-[12px] text-muted-foreground">
            Cal.com still has it at {say(calTime, zone)}
            {theirTz ? " their time" : ""} and will send them its usual
            reminder for that time. Tell them to ignore it. To move it on
            Cal.com as well, use Move on Cal.com instead.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !at || unchanged}>
            {saving ? "Moving…" : "Move it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
