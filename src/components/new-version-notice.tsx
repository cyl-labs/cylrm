"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useCallLine } from "@/components/calls/call-line";
import { useTabOnCall } from "@/components/calls/line-presence";

/**
 * Tell a tab that the CRM has been updated and it is running the old version
 * (2026-09-29).
 *
 * A browser keeps the code it loaded until the page is reloaded, so a deploy
 * changes nothing for somebody already logged in, and a tab left open all day
 * eventually errors ("Could not save", or a screen that will not load) against
 * a server that has moved on. `/api/version` says which build the server runs
 * and `CYLRM_BUILD_ID` is the one this tab was built as (both stamped by
 * `deploy.sh`); when they differ a notice offers the reload.
 *
 * It only ever asks. A reload hangs up a call and throws away notes typed for
 * an outcome, so the person chooses the moment, and the text says what to
 * finish first. A build called "dev" cannot be compared and never shows it.
 *
 * Solid `bg-card` and `fixed`, for the reason the incoming-call banner is: a
 * tint on a fixed overlay lets the page read through it.
 */
const MINE = process.env.CYLRM_BUILD_ID ?? "dev";
const CHECK_EVERY_MS = 60_000;

export function NewVersionNotice() {
  const [stale, setStale] = React.useState(false);
  const onCall = useTabOnCall();
  const { lastLeadId } = useCallLine();

  React.useEffect(() => {
    if (MINE === "dev") return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        // The server may be mid-restart or a dev build; only a real, different
        // build counts.
        if (!stopped && build && build !== "dev" && build !== MINE) {
          setStale(true);
        }
      } catch {
        // Offline, or the app is restarting: ask again next time.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const t = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border bg-card p-3 text-sm shadow-lg"
    >
      <p className="flex-1">
        <span className="font-medium">The CRM has been updated.</span>{" "}
        {onCall
          ? "Reload the page once your call ends."
          : lastLeadId !== null
            ? "Save your last call first, then reload the page."
            : "Reload the page to get the new version."}
      </p>
      <Button
        size="sm"
        disabled={onCall}
        onClick={() => window.location.reload()}
      >
        Reload
      </Button>
    </div>
  );
}
