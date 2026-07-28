"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ThreadSheet } from "@/components/pipeline/thread-sheet";

export type DealCard = {
  id: number;
  stage: "replied" | "interested" | "demo_booked" | "won" | "lost";
  contactName: string | null;
  contactEmail: string;
  company: string | null;
  campaignName: string;
  asksToBeRemoved?: boolean;
  stageSince: string;
};

const STAGES = [
  { key: "replied", label: "Replied" },
  { key: "interested", label: "Interested" },
  { key: "demo_booked", label: "Demo booked" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;

function daysIn(since: string) {
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

export function PipelineBoard({ deals }: { deals: DealCard[] }) {
  const router = useRouter();
  const [dragId, setDragId] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const [openDealId, setOpenDealId] = React.useState<number | null>(null);
  // Optimistic stage overrides while the PATCH is in flight.
  const [overrides, setOverrides] = React.useState<Record<number, DealCard["stage"]>>({});

  async function moveDeal(dealId: number, toStage: DealCard["stage"]) {
    const current = deals.find((d) => d.id === dealId);
    if (!current || (overrides[dealId] ?? current.stage) === toStage) return;
    setOverrides((o) => ({ ...o, [dealId]: toStage }));
    try {
      const res = await fetch(`/api/deals/${dealId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: toStage }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to move deal.");
        setOverrides((o) => {
          const { [dealId]: _, ...rest } = o;
          return rest;
        });
        return;
      }
      router.refresh();
    } catch {
      toast.error("Failed to move deal — network error.");
      setOverrides((o) => {
        const { [dealId]: _, ...rest } = o;
        return rest;
      });
    }
  }

  const stageOf = (d: DealCard) => overrides[d.id] ?? d.stage;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-5 gap-3">
      {STAGES.map((stage) => {
        const cards = deals.filter((d) => stageOf(d) === stage.key);
        return (
          <div
            key={stage.key}
            className={cn(
              "flex min-h-0 flex-col rounded-lg border bg-muted/30",
              dragOver === stage.key && "border-primary/50 bg-primary/5",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(stage.key);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (dragId !== null) moveDeal(dragId, stage.key);
              setDragId(null);
            }}
            data-column={stage.key}
          >
            <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                {stage.label}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground/70">
                {cards.length}
              </span>
            </div>
            <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {cards.map((d) => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(d.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => setOpenDealId(d.id)}
                  className="cursor-grab rounded-md border bg-card p-3 shadow-xs transition-colors hover:border-ring/60 active:cursor-grabbing"
                  data-deal-id={d.id}
                >
                  <p className="text-[13px] font-medium leading-tight">
                    {d.contactName ?? d.contactEmail}
                  </p>
                  {d.company && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {d.company}
                    </p>
                  )}
                  {d.asksToBeRemoved && (
                    <Badge className="mt-2 bg-warning/10 text-[11px] text-warning">
                      Asks to be removed
                    </Badge>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className="max-w-32 justify-start text-[11px]"
                    >
                      <span className="min-w-0 truncate">{d.campaignName}</span>
                    </Badge>
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {daysIn(d.stageSince)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <ThreadSheet
        dealId={openDealId}
        onOpenChange={(open) => {
          if (!open) setOpenDealId(null);
        }}
      />
    </div>
  );
}
