"use client";

import * as React from "react";
import { X } from "lucide-react";

/**
 * A notice you can put away, that comes back when the thing it reports changes.
 *
 * Built for the out-of-hours banner on Stats, which was correct and unclearable:
 * it reports a thirty-day window, so calls made weeks ago by people who have
 * since left kept it on screen with nothing anybody could do about it. A
 * warning that cannot be acted on and cannot be dismissed is one people learn
 * to read past, which costs the warning its job.
 *
 * **Dismissal is keyed on the count, not on time.** Putting away "74 calls out
 * of hours" hides exactly that; the next one makes it 75 and the banner
 * returns. So it stays quiet about history and still speaks up the moment
 * somebody rings a prospect at four in the morning — which is the only version
 * of this worth having.
 *
 * Per browser, like the push toggle, and for the same reason: there is nowhere
 * on a user row this belongs, and being asked again on a new machine is the
 * correct failure. localStorage is wrapped because a private window throws on
 * access rather than returning null.
 */
export function DismissibleNotice({
  /** Distinguishes one notice from another in storage. */
  id,
  /** What is being reported. Changing it brings the notice back. */
  signature,
  children,
}: {
  id: string;
  signature: string | number;
  children: React.ReactNode;
}) {
  // Starts shown so the first client render matches the server's HTML; the
  // effect below is what hides it. Reading storage during render instead would
  // be a hydration mismatch on every dismissed notice.
  const [hidden, setHidden] = React.useState(false);
  const key = `cylrm-dismissed-${id}`;

  React.useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(key) === String(signature));
    } catch {
      // Storage blocked: the notice simply stays, which is the safe direction.
    }
  }, [key, signature]);

  if (hidden) return null;

  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(key, String(signature));
          } catch {
            // Dismiss for this view even if it cannot be remembered.
          }
          setHidden(true);
        }}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" strokeWidth={2.4} />
      </button>
    </div>
  );
}
