"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActivateDialog } from "@/components/campaigns/activate-dialog";
import { CAMPAIGN_STATUS_BADGE } from "@/components/campaigns/status";

export function CampaignStatusControl({
  campaignId,
  status,
}: {
  campaignId: number;
  status: "draft" | "active" | "paused";
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  async function setStatus(next: "active" | "paused") {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to update status.");
        return;
      }
      toast.success(next === "active" ? "Campaign activated." : "Campaign paused.");
      setConfirmOpen(false);
      router.refresh();
    } catch {
      toast.error("Failed to update status — network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Badge className={CAMPAIGN_STATUS_BADGE[status]}>{status}</Badge>
      {status === "active" ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus("paused")}>
          <Pause data-icon="inline-start" />
          Pause
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
          <Play data-icon="inline-start" />
          Activate
        </Button>
      )}
      <ActivateDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        campaignId={campaignId}
        confirming={busy}
        onConfirm={() => setStatus("active")}
      />
    </div>
  );
}
