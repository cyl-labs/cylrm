"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";
import type { Meeting } from "@/lib/meetings";
import { MeetingCallButton } from "@/components/calls/meeting-call-button";
import { PrepareContracts } from "@/components/calls/prepare-contracts";
import type { SavedLine } from "@/components/calls/second-line";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ANSWERS: { value: string; label: string }[] = [
  { value: "showed_up", label: "They showed up" },
  { value: "no_show", label: "No show" },
  { value: "not_interested", label: "Not interested" },
  { value: "booked_follow_up", label: "Booked a follow-up" },
];

/**
 * A practice meeting's row (2026-10-05). It stands in for the real row, so
 * none of the real controls (attendance, contracts, texts, follow-ups) are
 * drawn: those write things that count. What is here is the part worth
 * practising, which is ringing the prospect, merging the voice agent in and
 * saying how it went. The answer is stored on the meeting itself and never
 * reaches payroll.
 */
export function TrainingMeetingRow({
  m,
  tz,
  lines,
  isFounder,
}: {
  m: Meeting;
  tz: string;
  lines: SavedLine[];
  isFounder: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const at = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(m.startAt));

  async function answer(outcome: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${m.id}/training`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Could not save that.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this practice meeting?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${m.id}/training`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Could not remove it.");
        return;
      }
      toast.success("Practice meeting removed.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const who = m.attendeeName ?? "the prospect";

  return (
    <li className="rounded-xl border border-dashed bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <GraduationCap className="size-3" />
          Training
        </Badge>
        <p className="text-[15px] font-bold">Practice demo with {who}</p>
        <span className="text-[13px] text-muted-foreground">{at}</span>
        {isFounder && m.closerName && (
          <span className="text-[13px] text-muted-foreground">
            Closer: {m.closerName}
          </span>
        )}
      </div>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[13px] text-muted-foreground">
        <li>Press Call them. {who}&apos;s browser rings, so they need the CRM open.</li>
        <li>Run the demo. When it is time, press Add call and merge the voice agent in.</li>
        <li>Fill in the contracts (Prepare contracts), then say how it went. Nothing counts toward pay or stats, and nothing is sent.</li>
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MeetingCallButton
          who={who}
          to={m.dialTo}
          from={m.dialFrom}
          leadId={null}
          rowKey={`meeting:${m.id}`}
          blocked={null}
          note="Practice meeting. This rings your colleague, not a real business."
          label="Call them"
          lines={lines}
        />
        {/* The real form, in practice mode: nothing reaches DocuSeal. */}
        <PrepareContracts meeting={m} tz={tz} signingBase="" practice />
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            type="button"
            disabled={busy}
            onClick={() => void answer(m.trainingOutcome === a.value ? null : a.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-60",
              m.trainingOutcome === a.value && "bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            {a.label}
          </button>
        ))}
        {isFounder && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="ml-auto rounded-md px-3 py-1.5 text-[13px] font-semibold text-destructive hover:bg-muted disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
      {m.trainingOutcome && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Saved as practice. Press the same button again to clear it.
        </p>
      )}
    </li>
  );
}
