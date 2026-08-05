"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ThreadSheet } from "@/components/pipeline/thread-sheet";
import { useTouchDrag } from "@/components/kanban/use-touch-drag";

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

  // Touch has no HTML5 drag events; this rebuilds the gesture on pointer ones.
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const touch = useTouchDrag({
    scrollerRef,
    canDrop: (column) => STAGES.some((s) => s.key === column),
    onDrop: (id, column) => moveDeal(id, column as DealCard["stage"]),
  });
  const draggingDeal = deals.find((d) => d.id === touch.dragId) ?? null;

  return (
    // Five columns only fit a wide screen. Narrower than `lg` the board
    // becomes a snapping horizontal scroller — one column at a time, which is
    // how a phone reads a kanban anyway.
    <div
      ref={scrollerRef}
      className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-x-visible lg:px-0"
    >
      {STAGES.map((stage) => {
        const cards = deals.filter((d) => stageOf(d) === stage.key);
        return (
          <div
            key={stage.key}
            className={cn(
              "flex min-h-0 w-[78vw] max-w-[320px] shrink-0 snap-start flex-col rounded-lg border bg-muted/30 lg:w-auto lg:max-w-none lg:shrink",
              (dragOver === stage.key || touch.over === stage.key) &&
                "border-primary/50 bg-primary/5",
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
            <div
              data-column-scroll
              className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2"
            >
              {cards.map((d) => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(d.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => {
                    // A drag that ends on the card it started from must not
                    // also count as a tap opening the thread.
                    if (touch.dragId === null) setOpenDealId(d.id);
                  }}
                  {...touch.cardProps(d.id)}
                  className={cn(
                    "group cursor-grab rounded-md border bg-card p-3 shadow-xs transition-colors hover:border-ring/60 active:cursor-grabbing",
                    touch.dragId === d.id && "opacity-40",
                  )}
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
                  {/* Dragging is a mouse gesture — HTML5 drag events never
                      fire on touch — so the stage is also movable from a
                      menu. Always visible where dragging cannot work; on a
                      pointer screen it waits for hover or keyboard focus so
                      it does not clutter every card. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1 text-[11px] text-muted-foreground transition-[color,opacity] hover:border-solid hover:text-foreground lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100 lg:data-[state=open]:opacity-100"
                    >
                      <ArrowRightLeft className="size-3" />
                      Move
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {STAGES.filter((s) => s.key !== stage.key).map((s) => (
                        <DropdownMenuItem
                          key={s.key}
                          onSelect={() => moveDeal(d.id, s.key)}
                        >
                          {s.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {draggingDeal && touch.pointer && (
        <div
          className="pointer-events-none fixed z-50 w-[70vw] max-w-[280px] -translate-x-1/2 -translate-y-1/2 rotate-2 rounded-md border border-primary bg-card p-3 shadow-lg"
          style={{ left: touch.pointer.x, top: touch.pointer.y }}
        >
          <p className="truncate text-[13px] font-medium leading-tight">
            {draggingDeal.contactName ?? draggingDeal.contactEmail}
          </p>
          {draggingDeal.company && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {draggingDeal.company}
            </p>
          )}
        </div>
      )}
      <ThreadSheet
        dealId={openDealId}
        onOpenChange={(open) => {
          if (!open) setOpenDealId(null);
        }}
      />
    </div>
  );
}
