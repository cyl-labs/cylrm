"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COMMON_TIMEZONES = [
  "Asia/Singapore",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
  "UTC",
];

export type SendingWindow = {
  sendingWindowStart: string;
  sendingWindowEnd: string;
  sendingTimezone: string;
  sendWeekdaysOnly: boolean;
  postalAddress: string | null;
};

function useNow() {
  // null until mounted so the server render never contains a clock value
  // (avoids a hydration mismatch).
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function timeIn(now: Date, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return "—";
  }
}

function TimezoneClock({ selectedTz }: { selectedTz: string }) {
  const now = useNow();
  const systemTz = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  if (!now) return null;
  const sameTz = systemTz === selectedTz;
  return (
    <div className="space-y-1 rounded-lg bg-muted px-3 py-2.5 text-xs font-semibold">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">Your time ({systemTz})</span>
        <span className="tabular-nums">{timeIn(now, systemTz)}</span>
      </div>
      {!sameTz && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">In {selectedTz}</span>
          <span className="tabular-nums">{timeIn(now, selectedTz)}</span>
        </div>
      )}
    </div>
  );
}

export function SendingWindowCard({ initial }: { initial: SendingWindow }) {
  const router = useRouter();
  const [start, setStart] = React.useState(initial.sendingWindowStart);
  const [end, setEnd] = React.useState(initial.sendingWindowEnd);
  const [timezone, setTimezone] = React.useState(initial.sendingTimezone);
  const [weekdaysOnly, setWeekdaysOnly] = React.useState(
    initial.sendWeekdaysOnly,
  );
  const [postalAddress, setPostalAddress] = React.useState(
    initial.postalAddress ?? "",
  );
  const [saving, setSaving] = React.useState(false);

  const timezones = COMMON_TIMEZONES.includes(initial.sendingTimezone)
    ? COMMON_TIMEZONES
    : [initial.sendingTimezone, ...COMMON_TIMEZONES];

  const dirty =
    start !== initial.sendingWindowStart ||
    end !== initial.sendingWindowEnd ||
    timezone !== initial.sendingTimezone ||
    weekdaysOnly !== initial.sendWeekdaysOnly ||
    postalAddress !== (initial.postalAddress ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sendingWindowStart: start,
          sendingWindowEnd: end,
          sendingTimezone: timezone,
          sendWeekdaysOnly: weekdaysOnly,
          postalAddress,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to save sending window.");
        return;
      }
      toast.success("Sending window saved.");
      router.refresh();
    } catch {
      toast.error("Failed to save sending window — network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Sending window</CardTitle>
        <CardDescription className="text-[13px]">
          The scheduler only sends inside this window, app-wide. It also sets
          when daily caps reset.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="window-start">Start</Label>
              <Input
                id="window-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="window-end">End</Label>
              <Input
                id="window-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="window-tz">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="window-tz" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="weekdays-only"
              checked={weekdaysOnly}
              onCheckedChange={(v) => setWeekdaysOnly(v === true)}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor="weekdays-only" className="font-normal">
                Weekdays only
              </Label>
              <p className="text-xs text-muted-foreground">
                Skip Saturday and Sunday, judged in the timezone above. A
                follow-up due 72h after a Thursday send waits until Monday.
              </p>
            </div>
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="postal-address">Postal address</Label>
            <Textarea
              id="postal-address"
              value={postalAddress}
              onChange={(e) => setPostalAddress(e.target.value)}
              rows={3}
              placeholder={"Cyl Labs Pte Ltd\n1 Example Road #01-01\nSingapore 000000"}
            />
            <p className="text-xs text-muted-foreground">
              Appended to every campaign email alongside the unsubscribe link.
              US commercial email is required to carry a real postal address.
            </p>
          </div>
          <TimezoneClock selectedTz={timezone} />
          <Button type="submit" size="sm" disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
