"use client";

import * as React from "react";
import { toast } from "sonner";
import { PhoneCall, UserRound } from "lucide-react";
import type { QueueLead } from "@/lib/calls";
import { useCallLine } from "@/components/calls/call-line";
import { useLineLeader } from "@/components/calls/line-presence";
import { type TelnyxLine } from "@/components/calls/use-telnyx-call";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The owner's own number, on the dial card (2026-09-26).
 *
 * A gatekeeper handing over the owner's cell is one of the best things a call
 * can produce, and until this the only way to ring that number was the Keypad,
 * which logs nothing on a lead: Akshansh was given Just Dump It's partner
 * Ryan's number, talked to him for seven minutes, and the business still read
 * "Gatekeeper" with nowhere to write what was said or book the demo.
 *
 * Saved on the lead, so the call is rung *on this card*: the notes, outcome,
 * booking and recording land on this business, the next card to show it
 * offers the number first, and a call or text back from it is recognised.
 * Named for what it is from the caller's side rather than as "another
 * number", which the founders found unclear.
 *
 * Keyed on the lead by the parent, not on the call, so a number saved and
 * dialled here is still shown when that call ends.
 */
export function DirectLine({
  lead,
  line,
  enabled,
}: {
  lead: QueueLead;
  line: TelnyxLine;
  /** False when this caller dials from their own handset. */
  enabled: boolean;
}) {
  const { setActiveLead } = useCallLine();
  const holder = useLineLeader();
  // What was saved here, until the page next loads the lead with it.
  const [saved, setSaved] = React.useState<{
    phone: string;
    name: string | null;
  } | null | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const [number, setNumber] = React.useState("");
  const [who, setWho] = React.useState("");
  const [busySaving, setBusySaving] = React.useState(false);

  const current =
    saved === undefined
      ? lead.directPhone
        ? { phone: lead.directPhone, name: lead.directName }
        : null
      : saved;

  const onCall = line.state !== "idle";
  const canCall =
    enabled && holder && line.ready && !onCall && !lead.dncBlock && !!lead.dialFrom;
  const firstName = current?.name?.split(/[\s,]/)[0] || null;

  function dial(to: string) {
    // Whose call this is, so the outcome and recording land on this business.
    setActiveLead(lead.id);
    line.dial(to, lead.directDialFrom ?? lead.dialFrom!);
  }

  async function save(andCall: boolean, clear = false) {
    setBusySaving(true);
    try {
      const res = await fetch(`/api/call-leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clear ? { directPhone: "" } : { directPhone: number, directName: who },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        directPhone?: string | null;
        directName?: string | null;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that number.");
        return;
      }
      const next = data.directPhone
        ? { phone: data.directPhone, name: data.directName ?? null }
        : null;
      setSaved(next);
      setOpen(false);
      setNumber("");
      setWho("");
      toast.success(clear ? "Removed their number." : "Saved on this business.");
      if (andCall && next && canCall) dial(next.phone);
    } catch {
      toast.error("Could not save that number: network error.");
    } finally {
      setBusySaving(false);
    }
  }

  // A saved number: offered first, above the business line.
  if (current && !open) {
    return (
      <div className="mt-2 rounded-xl border bg-muted/40 px-3 py-2.5 text-left">
        <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
          Owner&rsquo;s own number
        </p>
        <p className="mt-0.5 text-[14px] font-semibold">
          {current.name ? `${current.name} · ` : ""}
          <span className="tabular-nums">{current.phone}</span>
        </p>
        {canCall && (
          <Button className="mt-2 h-11 w-full" onClick={() => dial(current.phone)}>
            <PhoneCall data-icon="inline-start" />
            Call {firstName ?? "them"} directly
          </Button>
        )}
        {!onCall && (
          <div className="mt-1.5 flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={busySaving}
              onClick={() => {
                setNumber(current.phone);
                setWho(current.name ?? "");
                setOpen(true);
              }}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busySaving}
              onClick={() => void save(false, true)}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (onCall) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-semibold text-primary transition-colors hover:bg-muted"
      >
        <UserRound className="size-4" strokeWidth={2.2} />
        Got the owner&rsquo;s own number?
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border bg-muted/40 px-3 py-3 text-left">
      <p className="text-[14px] font-bold">Call the owner on their own number</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        If someone gave you the owner&rsquo;s or manager&rsquo;s own number, add
        it here. It is saved on this business, so your notes and booking go on
        this lead, and next time this card offers it first. Use this rather than
        the Keypad, which saves nothing.
      </p>
      <div className="mt-2.5 space-y-1.5">
        <Label htmlFor={`direct-number-${lead.id}`}>Their number</Label>
        <Input
          id={`direct-number-${lead.id}`}
          inputMode="tel"
          placeholder="+1 469 835 9723"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
      </div>
      <div className="mt-2 space-y-1.5">
        <Label htmlFor={`direct-who-${lead.id}`}>Whose number is it?</Label>
        <Input
          id={`direct-who-${lead.id}`}
          placeholder="Ryan, owner"
          value={who}
          onChange={(e) => setWho(e.target.value)}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          disabled={busySaving || !number.trim()}
          onClick={() => void save(canCall)}
        >
          {canCall && <PhoneCall data-icon="inline-start" />}
          {busySaving ? "Saving…" : canCall ? "Save and call" : "Save number"}
        </Button>
        <Button
          variant="ghost"
          disabled={busySaving}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
