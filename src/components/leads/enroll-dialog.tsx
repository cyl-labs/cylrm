"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Guarded = { contactId: number; email: string; reason: string };
type Skipped = { duplicates: number; unsubscribed: number };

function summarize(data: {
  enrolled: number;
  skipped: Skipped;
  alreadyEnrolled: string[];
}) {
  const parts = [`${data.enrolled} enrolled`];
  if (data.skipped.duplicates) parts.push(`${data.skipped.duplicates} duplicates skipped`);
  if (data.skipped.unsubscribed) parts.push(`${data.skipped.unsubscribed} unsubscribed skipped`);
  if (data.alreadyEnrolled.length)
    parts.push(`${data.alreadyEnrolled.length} already in an active sequence`);
  return parts.join(", ") + ".";
}

export function EnrollDialog({
  open,
  onOpenChange,
  contactIds,
  campaigns,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: number[];
  campaigns: { id: number; name: string }[];
  onEnrolled: () => void;
}) {
  const router = useRouter();
  const [campaignId, setCampaignId] = React.useState(
    campaigns.length > 0 ? String(campaigns[0].id) : "",
  );
  const [guarded, setGuarded] = React.useState<Guarded[] | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setGuarded(null);
      setError(null);
      setSubmitting(false);
    }
  }

  async function submit(confirmGuarded: boolean) {
    if (submitting || campaignId === "") return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: Number(campaignId),
          contactIds,
          confirmGuarded,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && Array.isArray(data.guarded)) {
        setGuarded(data.guarded);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Enroll failed (${res.status}).`);
        return;
      }
      toast.success(summarize(data));
      handleOpenChange(false);
      onEnrolled();
      router.refresh();
    } catch {
      setError("Enroll failed — network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {guarded ? (
          <>
            <DialogHeader>
              <DialogTitle>Re-engagement warning</DialogTitle>
              <DialogDescription>
                These contacts already have a deal in the pipeline. Enrolling
                them again may re-approach someone mid-conversation.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-48 space-y-1 overflow-auto py-2 text-[13px]">
              {guarded.map((g) => (
                <li key={g.contactId}>
                  <span className="font-medium">{g.email}</span>{" "}
                  <span className="text-muted-foreground">— {g.reason}</span>
                </li>
              ))}
            </ul>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={submitting}
                onClick={() => submit(true)}
              >
                {submitting ? "Enrolling…" : "Enroll anyway"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Enroll in campaign</DialogTitle>
              <DialogDescription>
                {contactIds.length} selected contact
                {contactIds.length === 1 ? "" : "s"}. Duplicates and
                unsubscribed emails are skipped automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="enroll-campaign">Campaign</Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger id="enroll-campaign" className="w-full">
                  <SelectValue placeholder="No campaigns yet" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error && <p className="text-[13px] text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                disabled={submitting || campaignId === ""}
                onClick={() => submit(false)}
              >
                {submitting ? "Enrolling…" : "Enroll"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
