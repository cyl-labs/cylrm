"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * When a weekly reminder goes out, for whichever reminder it is handed.
 *
 * One control for both the payday reminder and the quota digest. They were
 * built a couple of hours apart and ended up behaving differently for no
 * reason anybody could defend — one hard-coded to Friday because that is how
 * it was asked for, the other settable because that is how *it* was asked for.
 * A second copy of this card would have been the same mistake one level down.
 *
 * The sentence under the controls is the point of it: a weekday number and an
 * hour tell you what was stored, not what will happen, and the thing worth
 * being sure of is the hour landing in the right zone.
 */

export type ReminderSchedule = {
  on: boolean;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** 0-23, read in the recipient's own zone. */
  hour: number;
};

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

/** "5pm", "9am", "midnight" — how somebody says an hour, not how a clock
 *  stores one. */
function hourLabel(h: number) {
  if (h === 0) return "midnight";
  if (h === 12) return "midday";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function ReminderScheduleCard({
  which,
  initial,
  /** What this reminder is, finishing the sentence "…with". */
  carries,
  /** Anything a reader should know before choosing a time — the quota one
   *  reports on a week the US floor has not finished at 5pm local. */
  caveat,
  /** Said when it is switched off, so the consequence is stated rather than
   *  left to be inferred from an unticked box. */
  offNote,
}: {
  which: "payroll" | "quota";
  initial: ReminderSchedule;
  carries: string;
  caveat?: React.ReactNode;
  offNote: string;
}) {
  const router = useRouter();
  const [on, setOn] = React.useState(initial.on);
  const [weekday, setWeekday] = React.useState(initial.weekday);
  const [hour, setHour] = React.useState(initial.hour);
  const [saving, setSaving] = React.useState(false);

  const dirty =
    on !== initial.on || weekday !== initial.weekday || hour !== initial.hour;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ which, on, weekday, hour }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not save the reminder.");
        return;
      }
      toast.success("Reminder saved.");
      router.refresh();
    } catch {
      toast.error("Could not reach the CRM, so nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  const dayName = DAYS.find((d) => d.value === weekday)?.label ?? "Friday";

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={`${which}-on`}
          checked={on}
          onCheckedChange={(v) => setOn(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor={`${which}-on`} className="font-normal">
          Send this reminder
        </Label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${which}-day`} className="text-[12px]">
            Day
          </Label>
          <Select
            value={String(weekday)}
            onValueChange={(v) => setWeekday(Number(v))}
            disabled={!on}
          >
            <SelectTrigger
              id={`${which}-day`}
              size="sm"
              className="w-full sm:w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => (
                <SelectItem key={d.value} value={String(d.value)}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${which}-hour`} className="text-[12px]">
            Time
          </Label>
          <Select
            value={String(hour)}
            onValueChange={(v) => setHour(Number(v))}
            disabled={!on}
          >
            <SelectTrigger
              id={`${which}-hour`}
              size="sm"
              className="w-full sm:w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* What will actually happen, in the words somebody would use. The zone
          is the half worth spelling out: the numbers themselves are cut in
          Eastern so they cannot depend on who is reading them, but a reminder
          is a nudge to a human and 5pm has to mean 5pm where that human is. */}
      <p className="text-[12px] text-muted-foreground">
        {on ? (
          <>
            Every <span className="font-semibold text-foreground">{dayName}</span>{" "}
            at{" "}
            <span className="font-semibold text-foreground">
              {hourLabel(hour)}
            </span>{" "}
            in your own timezone, {carries}. Founders only, and it needs
            notifications switched on in this browser.
            {caveat ? <> {caveat}</> : null}
          </>
        ) : (
          offNote
        )}
      </p>
    </div>
  );
}
