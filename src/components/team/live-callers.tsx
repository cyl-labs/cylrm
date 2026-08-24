"use client";

import * as React from "react";
import { PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";

type Presence = { userId: number; name: string; seconds: number };

/** Slower than the 15s heartbeat, so a caller who has just hung up clears
 *  within one poll, and faster than the 45s freshness window, so nobody is
 *  shown live who has already gone quiet. */
const POLL_MS = 10_000;

function mmss(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Who is on a call this second.
 *
 * The reason this exists is deploys: restarting the app under someone
 * mid-conversation does not drop the call — the audio runs browser-to-Telnyx
 * and never touches this server — but it does break the request that saves
 * their outcome, and it errors whatever they are looking at. So the question
 * worth answering before shipping is "is anyone live", and `deploy.sh` asks
 * the database the same question and refuses on its own.
 *
 * Only browser callers appear. A handset caller's line is their own phone and
 * nothing here can see it, which is a silence rather than an idle.
 *
 * The clock ticks locally between polls: a timer that only moved every ten
 * seconds would read as frozen, which is the one thing a live indicator must
 * never look like.
 */
export function LiveCallers({ className }: { className?: string }) {
  // The figures and the moment they arrived, kept together: the local clock
  // counts forward from a known point rather than from whenever this last
  // happened to render.
  const [snap, setSnap] = React.useState<{
    live: Presence[];
    at: number;
  } | null>(null);
  const [clock, setClock] = React.useState(0);

  React.useEffect(() => {
    let stopped = false;

    const poll = async () => {
      const res = await fetch("/api/presence").catch(() => null);
      if (stopped || !res?.ok) return;
      const data = (await res.json().catch(() => null)) as {
        live?: Presence[];
      } | null;
      if (!stopped && data?.live) setSnap({ live: data.live, at: Date.now() });
    };

    poll();
    const p = setInterval(poll, POLL_MS);
    // `Date.now()` lives in here rather than in the render body: reading the
    // wall clock while rendering is what makes a server and a browser disagree
    // about the same node, and it is banned for refs for the same reason.
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      stopped = true;
      clearInterval(p);
      clearInterval(t);
    };
  }, []);

  const live = snap?.live ?? null;
  // Clamped, because `clock` is 0 until the first tick lands.
  const offset = snap ? Math.max(0, Math.floor((clock - snap.at) / 1000)) : 0;

  return (
    <div className={cn("px-4 py-3", className)}>
      {live === null ? (
        <p className="text-[13px] text-muted-foreground">Checking the floor…</p>
      ) : live.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nobody is on a call. Safe to deploy.
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold">
            {live.length === 1
              ? "1 caller is on a call"
              : `${live.length} callers are on a call`}
            <span className="ml-1.5 font-normal text-muted-foreground">
              — hold the deploy.
            </span>
          </p>
          <ul className="flex flex-wrap gap-2">
            {live.map((p) => (
              <li
                key={p.userId}
                className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary"
              >
                <PhoneCall className="size-3" />
                {p.name}
                <span className="tabular-nums font-normal">
                  {mmss(p.seconds + offset)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
