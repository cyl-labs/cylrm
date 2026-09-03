"use client";

import * as React from "react";
import { Phone, PhoneOff, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OUTCOME_LABELS } from "@/components/calls/outcome";
import type { CallOutcome } from "@/lib/calls";
import type { Incoming } from "@/components/calls/use-telnyx-call";
import { cn } from "@/lib/utils";

/**
 * Somebody ringing in.
 *
 * Deliberately the loudest thing on the screen, which nothing else in this app
 * is allowed to be: a call rings for a few seconds and then stops, so a subtle
 * banner is a missed call. Everything else here whispers because it can afford
 * to wait; this cannot.
 *
 * The number alone is the worst possible thing to answer with. Somebody ringing
 * back has already had a conversation, and opening with "who am I speaking to"
 * throws away the one advantage a callback has — so the lead is looked up while
 * it rings and the last notes are shown underneath. The lookup is best effort
 * and never delays the buttons: an unmatched number still rings, and answering
 * a stranger is the ordinary case for a business line.
 */

type Lead = {
  id: number;
  company: string | null;
  name: string | null;
  phone: string;
  title: string | null;
  list: string;
  history: {
    at: string;
    outcome: string;
    notes: string | null;
    caller: string | null;
  }[];
};

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function IncomingCall({
  incoming,
  /** True when a call is already up. Answering ends it, so the buttons say so
   *  rather than letting somebody drop a live conversation by reflex. */
  busy = false,
}: {
  incoming: Incoming;
  busy?: boolean;
}) {
  const [lead, setLead] = React.useState<Lead | null>(null);
  const [looked, setLooked] = React.useState(false);

  // Keyed on the number by the caller, so a second call arriving remounts this
  // and both values start fresh by construction rather than being cleared here.
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/inbound-lead?from=${encodeURIComponent(incoming.from)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { lead?: Lead | null } | null) => {
        if (cancelled) return;
        setLead(d?.lead ?? null);
        setLooked(true);
      })
      .catch(() => !cancelled && setLooked(true));
    return () => {
      cancelled = true;
    };
  }, [incoming.from]);

  const who = lead?.company || lead?.name || null;

  return (
    <div className="animate-in fade-in slide-in-from-top-2 mb-3 overflow-hidden rounded-xl border-2 border-success bg-success/10 shadow-sm">
      <div className="px-4 pb-3 pt-3.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-success">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-70" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          Incoming call
        </p>

        <p className="mt-1 truncate text-xl font-extrabold tracking-[-0.01em]">
          {who ?? incoming.from}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          {who ? (
            <>
              {incoming.from}
              {lead?.title ? ` · ${lead.title}` : ""}
              {lead ? ` · ${lead.list}` : ""}
            </>
          ) : looked ? (
            "Not a lead in the CRM"
          ) : (
            "Looking them up…"
          )}
        </p>

        {/* The notes, which are the reason to look at any of this. A callback
            promised last Tuesday says what for, and the outcome alone does
            not. */}
        {lead && lead.history.length > 0 && (
          <div className="mt-2.5 space-y-1.5 border-t border-success/30 pt-2.5">
            {lead.history.slice(0, 3).map((h, i) => (
              <div key={i} className="text-[12px]">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Clock className="size-3 shrink-0 text-muted-foreground" />
                  {OUTCOME_LABELS[h.outcome as CallOutcome] ?? h.outcome}
                  <span className="font-normal text-muted-foreground">
                    {ago(h.at)}
                    {h.caller ? ` · ${h.caller}` : ""}
                  </span>
                </p>
                {h.notes ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                    {h.notes}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {busy && (
        <p className="border-t border-success/30 bg-background/40 px-3 pt-2 text-center text-[12px] font-semibold text-muted-foreground">
          You are on a call — answering will end it.
        </p>
      )}
      {/* Full width and side by side, because this is answered with a thumb on
          a phone and under a couple of seconds of pressure. */}
      <div className={cn("flex gap-2 bg-background/40 p-2", !busy && "border-t border-success/30")}>
        <Button
          variant="outline"
          className={cn("h-12 flex-1 text-[15px]")}
          onClick={incoming.reject}
        >
          <PhoneOff data-icon="inline-start" />
          Decline
        </Button>
        <Button
          className="h-12 flex-1 bg-success text-[15px] text-primary-foreground hover:bg-success/85"
          onClick={incoming.answer}
        >
          <Phone data-icon="inline-start" />
          {busy ? "End & answer" : "Answer"}
        </Button>
      </div>
    </div>
  );
}
