"use client";

import * as React from "react";

/**
 * Which screen, if any, is holding the phone line.
 *
 * Two SIP registrations against one credential means Telnyx forks an inbound
 * invite to both of them, so a caller sitting on the dialler would see two
 * banners for one call and could answer the wrong one. The dialler and the
 * Keypad register their own line; this is how the app-wide listener knows to
 * stand down while one of them is mounted.
 *
 * A count rather than a flag, because navigating from the dialler to the Keypad
 * mounts the second before unmounting the first, and a flag would be cleared by
 * the departing screen a moment after the arriving one set it — leaving two
 * registrations live for the rest of the session.
 */
const LineContext = React.createContext<{
  claimed: boolean;
  claim: () => () => void;
}>({ claimed: false, claim: () => () => {} });

export function LinePresence({ children }: { children: React.ReactNode }) {
  const [holders, setHolders] = React.useState(0);
  const claim = React.useCallback(() => {
    setHolders((n) => n + 1);
    return () => setHolders((n) => Math.max(0, n - 1));
  }, []);
  const value = React.useMemo(
    () => ({ claimed: holders > 0, claim }),
    [holders, claim],
  );
  return <LineContext.Provider value={value}>{children}</LineContext.Provider>;
}

/** True while a screen is holding its own line. */
export function useLineClaimed(): boolean {
  return React.useContext(LineContext).claimed;
}

/** Held by a screen that registers a line of its own, for as long as it is
 *  mounted. No-op outside the provider, which is every screen off the Call CRM. */
export function useClaimLine(active: boolean): void {
  const { claim } = React.useContext(LineContext);
  React.useEffect(() => {
    if (!active) return;
    return claim();
  }, [active, claim]);
}
