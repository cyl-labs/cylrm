"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type TrainingPerson = {
  id: number;
  name: string;
  role: string;
  hasLine: boolean;
};

/** The wall clock in `tz`, `minutes` from now, as a datetime-local value. */
function inMinutes(minutes: number, tz: string): string {
  return new Date(Date.now() + minutes * 60_000)
    .toLocaleString("sv-SE", { timeZone: tz })
    .replace(" ", "T")
    .slice(0, 16);
}

const SELECT =
  "h-9 w-full rounded-md border bg-background px-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Hand a closer a practice meeting (founders only, 2026-10-05).
 *
 * Two people and a time: who is training, and whose phone plays the prospect.
 * The prospect can be a founder or another closer, since the point is to ring a
 * real line and merge the voice agent in. The dialog says, in its own words,
 * that nothing here counts, because a founder opening it for the first time
 * should not have to wonder whether a practice meeting can reach payroll.
 */
export function TrainingAssign({
  people,
  tz,
  zoneLabel,
}: {
  people: TrainingPerson[];
  tz: string;
  zoneLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [closerId, setCloserId] = React.useState("");
  const [partnerId, setPartnerId] = React.useState("");
  const [at, setAt] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const closers = people.filter((p) => p.role === "closer");

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/meetings/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closerUserId: Number(closerId),
          partnerUserId: Number(partnerId),
          at,
          tz,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        closer?: string;
        partner?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not set that up.");
        return;
      }
      toast.success(`${data.closer} now has a practice meeting with ${data.partner}.`);
      setOpen(false);
      setAt("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
        >
          <GraduationCap className="size-3.5" />
          Training meeting
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set up a practice meeting</DialogTitle>
          <DialogDescription>
            The closer gets a meeting on their Meetings screen and rings the
            person you pick, who plays the prospect. It looks and works like a
            real meeting: they can call, text (a real text, to that person's
            CRM line), draft the contracts and open them, and log what happened.
            It is practice only: nothing counts toward pay, stats or alerts, and
            the agreements are made with no email so nothing reaches anyone. You can remove it from the meeting.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="training-closer">Who is training</Label>
            <select
              id="training-closer"
              className={SELECT}
              value={closerId}
              onChange={(e) => setCloserId(e.target.value)}
            >
              <option value="">Pick a closer</option>
              {closers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {closers.length === 0 && (
              <p className="text-[12px] text-muted-foreground">
                There are no closers yet. Make someone a closer on Team first.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="training-partner">Who plays the prospect</Label>
            <select
              id="training-partner"
              className={SELECT}
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
            >
              <option value="">Pick a person</option>
              {people
                .filter((p) => String(p.id) !== closerId)
                .map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.hasLine}>
                    {p.name}
                    {p.role === "admin" ? " (founder)" : ""}
                    {p.hasLine ? "" : " (no phone line)"}
                  </option>
                ))}
            </select>
            <p className="text-[12px] text-muted-foreground">
              Their browser rings when the closer presses Call, so they need the
              CRM open.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="training-at">{`When (${zoneLabel})`}</Label>
            <Input
              id="training-at"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
            <div className="flex gap-1.5">
              {[10, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAt(inMinutes(m, tz))}
                  className="rounded-md border px-2 py-1 text-[12px] font-semibold hover:bg-muted"
                >
                  In {m} min
                </button>
              ))}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={saving || !closerId || !partnerId || !at}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Set up the practice meeting"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
