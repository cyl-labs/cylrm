"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CampaignRowActions({
  campaignId,
  name,
  enrolledCount,
}: {
  campaignId: number;
  name: string;
  enrolledCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    // Queued enrollments are removed with the campaign, so say how many
    // rather than letting the count vanish silently.
    const enrolledNote =
      enrolledCount > 0
        ? `\n\n${enrolledCount} queued enrollment${enrolledCount === 1 ? "" : "s"} will be removed. Those contacts stay in their lead list and can be enrolled elsewhere.`
        : "";
    if (!window.confirm(`Delete “${name}”?${enrolledNote}\n\nThis cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? `Failed to delete (${res.status}).`);
        return;
      }
      toast.success(`${name} deleted.`);
      router.refresh();
    } catch {
      toast.error("Failed to delete: network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal />
          <span className="sr-only">Actions for {name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" disabled={busy} onSelect={remove}>
          Delete campaign
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
