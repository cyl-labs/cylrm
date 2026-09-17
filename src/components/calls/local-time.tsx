"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CALLING_HOURS_LABEL,
  isOpenAt,
  type OpenRange,
} from "@/lib/call-hours";
import { describeDayHours } from "@/lib/opening-hours.mjs";

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
  hoursToday,
  className,
  /** Show the zone's short name too ("PDT"). Off in tight rows. */
  withZone = false,
}: {
  tz: string | null;
  /**
   * The business's opening hours today, or null when we do not have them.
   * Decides the colour, by the same rule the queue uses (`isOpenAt`), and is
   * said out loud when known: "Open today 7 AM to 4:30 PM" is what tells a
   * caller why a 4:45 call is red. Omitted in rows that only want the clock.
   */
  hoursToday?: OpenRange[] | null;
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
  let minutes: number;
  try {
    time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      ...(withZone ? { timeZoneName: "short" as const } : {}),
    }).format(now);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    minutes = part("hour") * 60 + part("minute");
  } catch {
    // An unrecognised zone is not worth an error boundary on a dial card.
    return null;
  }

  const known = hoursToday !== undefined && hoursToday !== null;
  const open = isOpenAt(known ? hoursToday : null, minutes);

  return (
    <span
      suppressHydrationWarning
      className={cn(
        "inline-flex flex-wrap items-center justify-center gap-x-1 tabular-nums",
        open ? "text-success" : "text-destructive",
        className,
      )}
      title={
        open
          ? "A good time to call"
          : `Outside ${CALLING_HOURS_LABEL}`
      }
    >
      {open ? (
        <Sun className="size-3.5 shrink-0" strokeWidth={2.2} />
      ) : (
        <Moon className="size-3.5 shrink-0" strokeWidth={2.2} />
      )}
      {time} there
      {/* Its own line at every width: a split day is long, and wrapping it
          after the clock left a stray separator at the start of a line. */}
      {known && (
        <span className="basis-full text-center text-muted-foreground">
          {hoursToday.length === 0
            ? "Closed today"
            : `Open today ${describeDayHours(hoursToday)}`}
        </span>
      )}
    </span>
  );
}
