"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useCallLine } from "@/components/calls/call-line";

/**
 * Keep every CRM tab in step with what was done in another.
 *
 * The badges and the lists are rendered on the server, so a tab only learned
 * about a change when it next loaded a page. Answer a text or clear a missed
 * call in one tab and the other went on showing the badge — and the row —
 * until somebody refreshed it, which reads as "it did not save".
 *
 * - **Any change saved in a tab tells the others.** Every successful
 *   non-GET request to `/api` is announced on a `BroadcastChannel`, rather than
 *   each screen remembering to announce its own: there are dozens of them, and
 *   the one that forgot would be the bug. The chatter that is not a change —
 *   the presence heartbeat, the line's token, objection hints — is left out.
 * - **A hidden tab catches up when it is looked at**, not while nobody is
 *   watching: an announcement to a hidden tab only marks it stale. So does
 *   being away for a minute, since a text or a call can arrive with no tab
 *   having done anything.
 * - **Never under a live call.** A refresh mid-call can move the dial card on,
 *   so it waits for the line to go idle.
 *
 * `router.refresh()` keeps what is typed in open boxes; it re-renders from the
 * server, it does not reload.
 */

const CHANNEL = "cylrm-changed";
/** Away this long and the tab refreshes on return even if nothing was said. */
const AWAY_MS = 60_000;
/** Several saves in a burst — a row cleared, then a text sent — are one refresh. */
const SETTLE_MS = 800;

/** Requests that change nothing another tab would show. */
const QUIET = [
  /^\/api\/presence/,
  /^\/api\/telnyx\/token/,
  /^\/api\/objection-hint/,
  /^\/api\/me(\/|\?|$)/,
  /^\/api\/quota-standings/,
  /^\/api\/spend\/refresh/,
  /\/transcribe(\?|$)/,
  /^\/api\/login/,
  /^\/api\/logout/,
];

function announces(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  if (method === "GET" || method === "HEAD") return false;
  let path: string;
  try {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return false;
    path = url.pathname;
  } catch {
    return false;
  }
  return path.startsWith("/api/") && !QUIET.some((re) => re.test(path));
}

export function TabSync() {
  const router = useRouter();
  const { line } = useCallLine();
  const idle = line.state === "idle";

  const stale = React.useRef(false);
  const hiddenAt = React.useRef<number | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleRef = React.useRef(idle);
  React.useEffect(() => {
    idleRef.current = idle;
  }, [idle]);

  const refresh = React.useCallback(() => {
    if (document.visibilityState !== "visible" || !idleRef.current) {
      stale.current = true;
      return;
    }
    stale.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, SETTLE_MS);
  }, [router]);

  // Announce this tab's changes.
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const res = await original(input, init);
      if (res.ok && announces(input, init)) {
        try {
          channel.postMessage(Date.now());
        } catch {
          // A closed channel on the way out; the other tabs catch up on focus.
        }
      }
      return res;
    };
    channel.onmessage = () => refresh();
    return () => {
      window.fetch = original;
      channel.close();
    };
  }, [refresh]);

  // Catch up on return, and after a call that held a refresh back.
  React.useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current !== null && Date.now() - hiddenAt.current > AWAY_MS;
      hiddenAt.current = null;
      if (stale.current || away) refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  React.useEffect(() => {
    if (idle && stale.current) refresh();
  }, [idle, refresh]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return null;
}
