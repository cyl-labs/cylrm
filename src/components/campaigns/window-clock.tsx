"use client";

import * as React from "react";

const MINUTES_PER_DAY = 24 * 60;

const timeToMinutes = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** Wall clock in the sending timezone, which is the only clock the scheduler
 *  cares about — the viewer could be anywhere. */
function zoneNow(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const num = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return {
    hour: num("hour") % 24,
    minute: num("minute"),
    second: num("second"),
    weekday,
    isWeekend: weekday === "Sat" || weekday === "Sun",
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function countdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * Live clock and countdown for the sending window.
 *
 * Rendered client-side and null until mounted: a clock in the server HTML
 * would be stale by the time it reached the browser and would trip a
 * hydration mismatch.
 */
export function WindowClock({
  start,
  end,
  timezone,
  weekdaysOnly,
}: {
  start: string;
  end: string;
  timezone: string;
  weekdaysOnly: boolean;
}) {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;

  let z;
  try {
    z = zoneNow(timezone, now);
  } catch {
    return null;
  }

  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  const nowSec = z.hour * 3600 + z.minute * 60 + z.second;
  const blockedByWeekend = weekdaysOnly && z.isWeekend;
  const open =
    !blockedByWeekend && nowSec >= startMin * 60 && nowSec < endMin * 60;

  const clock = `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}:${String(z.second).padStart(2, "0")}`;

  let tail: string;
  if (open) {
    tail = `sending stops in ${countdown(endMin * 60 - nowSec)}`;
  } else {
    // Walk forward to the next day the window is allowed to open on.
    const todayIndex = WEEKDAYS.indexOf(z.weekday);
    let days = nowSec < startMin * 60 ? 0 : 1;
    for (let guard = 0; guard < 8; guard++) {
      const wd = (todayIndex + days) % 7;
      const isWeekend = wd === 0 || wd === 6;
      if (!(weekdaysOnly && isWeekend)) break;
      days++;
    }
    const secondsUntil = days * MINUTES_PER_DAY * 60 + startMin * 60 - nowSec;
    tail = `sending resumes in ${countdown(secondsUntil)}`;
  }

  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium tabular-nums text-foreground">{clock}</span>{" "}
      {timezone.replace("_", " ")}: <span className="tabular-nums">{tail}</span>
    </p>
  );
}
