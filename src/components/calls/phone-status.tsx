"use client";

import * as React from "react";
import { Phone, PhoneOff } from "lucide-react";
import { useCallLine } from "@/components/calls/call-line";
import { useLineElsewhere } from "@/components/calls/line-presence";
import { cn } from "@/lib/utils";

/**
 * Is this browser's phone connected? (2026-10-04)
 *
 * A founder was rung by a teammate and nothing happened: the call reached the
 * line, Telnyx found nobody registered on it (SUBSCRIBER_ABSENT) and refused it
 * in four seconds, while the CRM sat open on screen. Nothing on the screen said
 * the phone was off, so there was nothing to fix until a call had already been
 * lost. This is that something: a small light in every page header.
 *
 * - **Phone on**: this tab holds the line and it is registered.
 * - **Phone in another tab**: another CRM tab holds it. One press brings it here.
 * - **Connecting...**, then **Phone not connected** after a few seconds, with a
 *   Reload: this tab should hold the line and has not registered.
 *
 * Drawn only for a login with a browser line.
 */
export function PhoneStatus() {
  const { enabled, live, line } = useCallLine();
  const { elsewhere, take } = useLineElsewhere();
  const ready = line.ready;
  // How long a tab that should be registered has gone without being ready, so a
  // brief connecting moment is not shouted as a fault.
  const [waited, setWaited] = React.useState(false);
  React.useEffect(() => {
    if (!enabled || !live || ready) {
      const reset = setTimeout(() => setWaited(false), 0);
      return () => clearTimeout(reset);
    }
    const t = setTimeout(() => setWaited(true), 10_000);
    return () => clearTimeout(t);
  }, [enabled, live, ready]);

  if (!enabled) return null;

  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold";

  if (!live) {
    return (
      <span className={cn(base, "border-warning/40 bg-warning/10")}>
        <PhoneOff className="size-3.5" strokeWidth={2.2} />
        {elsewhere === "call" ? "On a call in another tab" : "Phone is in another tab"}
        {elsewhere !== "call" && (
          <button
            type="button"
            onClick={take}
            className="underline underline-offset-2 hover:no-underline"
          >
            Use it here
          </button>
        )}
      </span>
    );
  }
  if (ready) {
    return (
      <span
        className={cn(base, "border-success/40 bg-success/10 text-success")}
        title="Calls to your number will ring in this tab"
      >
        <Phone className="size-3.5" strokeWidth={2.2} />
        Phone on
      </span>
    );
  }
  return (
    <span
      className={cn(
        base,
        waited ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10",
      )}
    >
      <PhoneOff className="size-3.5" strokeWidth={2.2} />
      {waited ? "Phone not connected" : "Connecting phone..."}
      {waited && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="underline underline-offset-2 hover:no-underline"
        >
          Reload
        </button>
      )}
    </span>
  );
}
