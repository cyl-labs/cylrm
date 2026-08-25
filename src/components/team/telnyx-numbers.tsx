"use client";

import * as React from "react";
import { PhoneOutgoing } from "lucide-react";
import type { TeamMember } from "@/lib/users";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What numbers the business owns, and who rings from each.
 *
 * Read-only on purpose. Numbers are bought, ported and released in the Telnyx
 * portal; the CRM's job is only to say which person uses which. An earlier
 * version let a number be set per market here as well, which meant the caller
 * ID on a call could come from two places and the screen showed neither.
 *
 * It exists because deleting that left nowhere to see the numbers at all, and
 * "assign one of your numbers" is a hard instruction to follow when the app
 * never says what you have.
 */
const COUNTRY = { SG: "Singapore", US: "US", GB: "UK" } as const;

export function TelnyxNumbers({
  numbers: initial,
  team,
  className,
}: {
  numbers: {
    phoneNumber: string;
    country: string | null;
    inbound: string | null;
    available: boolean;
    label: string | null;
  }[];
  team: TeamMember[];
  className?: string;
}) {
  const router = useRouter();
  const [numbers, setNumbers] = React.useState(initial);
  // Server data wins whenever the page refreshes.
  React.useEffect(() => setNumbers(initial), [initial]);

  // Which number's label is being typed, and what into. One at a time: this is
  // a note on a row, not a form.
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const holder = (n: string) => team.find((t) => t.telnyxDid === n) ?? null;

  async function saveLabel(phoneNumber: string, raw: string) {
    const label = raw.trim() === "" ? null : raw.trim();
    setEditing(null);
    const before = numbers.find((n) => n.phoneNumber === phoneNumber)?.label ?? null;
    if (label === before) return;

    setNumbers((p) =>
      p.map((n) => (n.phoneNumber === phoneNumber ? { ...n, label } : n)),
    );
    // Only `label` goes up. Sending `available` alongside it would make
    // renaming a note capable of putting a client's line back in the pool.
    const res = await fetch("/api/call-dids", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber, label }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      toast.error(data?.error ?? "Could not save the label.");
      setNumbers((p) =>
        p.map((n) =>
          n.phoneNumber === phoneNumber ? { ...n, label: before } : n,
        ),
      );
    }
  }

  async function toggle(phoneNumber: string, available: boolean) {
    setNumbers((p) =>
      p.map((n) => (n.phoneNumber === phoneNumber ? { ...n, available } : n)),
    );
    const res = await fetch("/api/call-dids", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber, available }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error("Could not save.");
      setNumbers((p) =>
        p.map((n) =>
          n.phoneNumber === phoneNumber ? { ...n, available: !available } : n,
        ),
      );
      return;
    }
    // The assign dropdowns are rendered from this same list on the server, so
    // the table below has to be told rather than left showing a stale option.
    router.refresh();
  }

  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-extrabold tracking-[-0.01em]">
          <PhoneOutgoing className="size-4 text-muted-foreground" strokeWidth={2.2} />
          Your Telnyx numbers
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Reserve the ones answering for a client and they stop appearing as
          options below. Label one to record what it is for, like a demo line,
          which is separate from whether anyone dials from it. Buy and release
          them in the Telnyx portal. Assigning one here only
          sets what a prospect sees; it changes nothing about the number in
          Telnyx. But a prospect who rings back reaches whatever is already on
          the other end, so avoid the ones answering for a client.
        </p>
      </div>

      {numbers.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted-foreground">
          No numbers on the account, or Telnyx could not be reached.
        </p>
      ) : (
        <ul className="divide-y">
          {numbers.map((n) => {
            const who = holder(n.phoneNumber);
            return (
              <li
                key={n.phoneNumber}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
              >
                <span className="font-bold tabular-nums">{n.phoneNumber}</span>
                <span className="text-muted-foreground">
                  {COUNTRY[n.country as keyof typeof COUNTRY] ?? n.country ?? "-"}
                </span>
                {n.inbound && (
                  <span
                    className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                    title={`Inbound calls to this number go to "${n.inbound}"`}
                  >
                    answers: {n.inbound}
                  </span>
                )}

                {/* Our own note, next to Telnyx's wiring badge because they
                    answer neighbouring questions: that one says what picks up,
                    this one says what the number is for. */}
                {editing === n.phoneNumber ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={60}
                    placeholder="e.g. demo line, Acme"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => saveLabel(n.phoneNumber, draft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveLabel(n.phoneNumber, draft);
                      // Escape has to clear the editor before blur fires, or
                      // the blur handler saves the draft it just abandoned.
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="h-6 w-44 rounded-md border bg-background px-1.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                  />
                ) : n.label ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(n.label ?? "");
                      setEditing(n.phoneNumber);
                    }}
                    className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/15"
                    title="Rename this label"
                  >
                    {n.label}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("");
                      setEditing(n.phoneNumber);
                    }}
                    className="text-[11px] font-semibold text-muted-foreground/70 hover:text-foreground"
                  >
                    + Label
                  </button>
                )}
                <span
                  className={cn(
                    "ml-auto",
                    who ? "font-semibold" : "text-muted-foreground",
                  )}
                >
                  {n.available ? (who ? who.name : "Nobody yet") : "Reserved"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0"
                  disabled={!n.available && !!who}
                  title={
                    !n.available && who
                      ? "Unassign it from that person first."
                      : undefined
                  }
                  onClick={() => toggle(n.phoneNumber, !n.available)}
                >
                  {n.available ? "Reserve" : "Make available"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
