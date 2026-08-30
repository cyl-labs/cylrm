"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What time it is where the lead is.
 *
 * The lists are national — one niche can span 152 area codes — and the callers
 * are overseas, so their own clock says nothing about whether a number can be
 * rung. Half past three in Honolulu is the failure this exists to stop, and
 * expecting a caller in Lagos to know which states are on Pacific time is not
 * a plan.
 *
 * Rendered in the browser and ticked every half minute rather than baked into
 * the page: a dial card can sit open for an hour, and a stale clock is worse
 * than none because it is believed. Server and client would in any case
 * disagree on "now", so this carries `suppressHydrationWarning` for the same
 * reason the relative timestamps elsewhere do.
 */
export function LocalTime({
  tz,
  className,
  /** Show the zone's short name too ("PDT"). Off in tight rows. */
  withZone = false,
}: {
  tz: string | null;
  className?: string;
  withZone?: boolean;
}) {
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Nothing to say for a toll-free number or an unmapped area code. Showing a
  // guess would be worse than showing nothing: the whole value here is that
  // the caller can trust it.
  if (!tz) return null;
  // Null until mounted, so the server renders nothing and there is no first
  // paint showing the droplet's idea of the time.
  if (!now) return null;

  let time: string;
  let hour: number;
  try {
    time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      ...(withZone ? { timeZoneName: "short" as const } : {}),
    }).format(now);
    hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
  } catch {
    // An unrecognised zone is not worth an error boundary on a dial card.
    return null;
  }

  const open = hour >= 9 && hour < 17;

  return (
    <span
      suppressHydrationWarning
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        open ? "text-success" : "text-destructive",
        className,
      )}
      title={
        open ? "Business hours where they are" : "Outside business hours there"
      }
    >
      {open ? (
        <Sun className="size-3.5 shrink-0" strokeWidth={2.2} />
      ) : (
        <Moon className="size-3.5 shrink-0" strokeWidth={2.2} />
      )}
      {time} there
    </span>
  );
}
